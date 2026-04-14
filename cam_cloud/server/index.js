import express from "express"
import dotenv from 'dotenv';
import http from "http";
import cors from "cors";
import { WebSocketServer } from 'ws';
import fs from'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid'; // npm install uuid
const JWT_SECRET = process.env.JWT_SECRET || null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const timeoutBuffer = fs.readFileSync(path.join(__dirname, 'assets/timeout.jpg'));
const offlineBuffer = fs.readFileSync(path.join(__dirname, 'assets/offline.jpg'));
const errorBuffer   = fs.readFileSync(path.join(__dirname, 'assets/error.jpg'));
// set up development or production env vars
const env = process.env.NODE_ENV || 'development';
dotenv.config({
  path: `.env.${env}`,
});
const PORT = parseInt(process.env.PORT);

// initialize express app, ws server, and middleware
const app = express();
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const verifyToken = (token) => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
};


class ClientManager {
  constructor(hubmanager) {
    this.clientsockets = {};
    this.hubmanager = hubmanager
  }
  add_client(ws, hubID, clientID) {
    // If this client is already connected, close the old socket first
    if (this.clientsockets[clientID]) {
      this.clientsockets[clientID].close();
    }
    console.log(`adding client:\n  hubID: ${hubID}\n  clientID: ${clientID}`)
    this.clientsockets[clientID] = ws;
    ws.on("message", (message) => {
      const msg = JSON.parse(message);
      if (msg.type === "servo_cmd" || msg.type == "laser_cmd") {
	      console.log(`Message recieved on client socket with clientID: ${clientID}\n  ${msg}`)
        const pyserver = this.hubmanager.hubs[hubID]?.socket
        if (pyserver) {
          msg["clientID"] = clientID
          pyserver.send(JSON.stringify(msg));
          console.log(`message relayed to hub: ${hubID}`)
        } else {
          console.error(`camera hub: ${hubID} is offline`)
          ws.send(JSON.stringify({ type: "error", data: "camera hub offline" }))
        }
      }
    }) 
    ws.on("close", () => {
      const pyserver = this.hubmanager.hubs[hubID]?.socket
      // remove client_user from devices associated with hubID
      if (pyserver) {
        for (let device of this.hubmanager.hubs[hubID].devices)
        pyserver.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device, hubID: 123, clientID}));
      }
      delete this.clientsockets[clientID];
      console.log(`client ws connection with client ID: ${clientID}`)
    })
  }
}
 
  class StreamManager {
    constructor(hubmanager) {
      this.runningstreams = {};
      this.hubmanager = hubmanager;
      this.pendingstreams = {};
      this.timeoutMs = 5000;
      // need to add an initialingstreams logic to avoid race conditions
    }

    async sendErrorFrame(res, buffer) {
    if (res.writableEnded) return;
    res.write(`--frame\r\n`);
    res.write(`Content-Type: image/jpeg\r\n`);
    res.write(`Content-Length: ${buffer.length}\r\n\r\n`);
    res.write(buffer);
    res.write(`\r\n`);
    setTimeout(() => res.end(), 100);
  }
    
    async add_viewer(res, hubID, deviceID, clientID) {
      console.log(`Client: ${clientID} connecting to stream: ${deviceID} on hub: ${hubID}`);
      let stream = `${hubID}/${deviceID}`
      if (!Object.hasOwn(this.runningstreams, stream)) {
        await this.start_stream(res, hubID, deviceID, clientID)
      } else {
        this.runningstreams[stream].viewers.add(res)
        console.log(`client: ${clientID} added to stream: ${deviceID} on hub: ${hubID}`)
      }
    }
    
    async start_stream(res, hubID, deviceID, clientID) {
      let stream = `${hubID}/${deviceID}`
      let timer;
      let requestId;
      //checking again if stream initiated by another client to avoid race conditions and duplicate streams
      try {
        if (this.runningstreams[stream]) {
            this.runningstreams[stream].viewers.add(res);
            console.log(`client: ${clientID} added to stream: ${deviceID} on hub: ${hubID}`)
            return; 
        }
        if (!this.hubmanager.hubs[hubID]) {
          throw new Error("HUB_OFFLINE");
        }        
        //set up promise that resolves after message is sent to hub to open up a ws
        const { promise, resolve, reject } = Promise.withResolvers();
        requestId = `${clientID}-${Date.now()}`
        this.pendingstreams[requestId] = resolve
        // time out if ws connection takes too long
        timer = setTimeout(() => {
          delete this.pendingstreams[requestId];
          reject(new Error ("HUB_TIMEOUT"));
        }, this.timeoutMs);
        console.log(`opening back channel ws with hub: ${hubID} for stream: ${deviceID}`)
        this.hubmanager.hubs[hubID].socket.send(JSON.stringify({ type: 'init_stream', role: "node_server", device: deviceID, socket_id: requestId}))
        let ws = await promise
        this.runningstreams[stream] = { streamSocket: ws, viewers: new Set([res]) }
  
        // set up listener that sends jpeg frames to clients res objects that are subscribed to stream 
        ws.on("message", (message) => {
          let clients = this.runningstreams[stream]?.viewers || [];
          for (let client of clients) {
            if (client.writableEnded) {
              clients.delete(client);
              continue;
            }
            client.write(message);
          }
        });
        // close stream for all clients on close initiated from hub
        ws.on("close", () => {
          let clients = this.runningstreams[stream]?.viewers || [];
          for (let client of clients) { 
            if (client.writableEnded) return; 
            client.end();
          }
          delete this.runningstreams[stream];
        });

      } catch (err) {
        console.error(`Stream start failed: ${err.message}`);
        
        // Determine which image to send
        let img = errorBuffer;
        if (err.message === "HUB_TIMEOUT") img = timeoutBuffer;
        if (err.message === "HUB_OFFLINE") img = offlineBuffer;
        
        await this.sendErrorFrame(res, img);
      } finally {
        clearTimeout(timer);
        delete this.pendingstreams[requestId];
      }
    }

  remove_viewer(res, hubID, deviceID, clientID) {
    console.log(`Client: ${clientID} disconnecting from stream: ${deviceID} on hub: ${hubID}`)
    let stream = `${hubID}/${deviceID}`
    const runningstream = this.runningstreams[stream]
    if (!runningstream) {
      console.log("no runningstream to disconnect from")
      return
    }
    runningstream.viewers.delete(res);
    if (!runningstream.viewers.size) {
      console.log(`Stoping stream`)
      runningstream.streamSocket.close()
      delete this.runningstreams[stream]
    }
  }

}


  

class HubManager {
  constructor(clientmanager = null, streammanager = null) {
    this.hubs = {};
    this.clientmanager = clientmanager;
    this.streammanager = streammanager;
  }

  add_socket(socket, hubID, devices) {
    console.log(`registering hub: ${hubID}`)
    this.hubs[hubID] = {
        devices: devices,
        socket
    }
    socket.on("message", (message) => {
      const msg = JSON.parse(message);
      console.log(`Message of type: ${msg.type} recieved from hub: ${hubID}`)
      if (msg.type == "sync_data") {
        if (this.hubs[msg.hubID]) {
          this.hubs[msg.hubID].devices = msg.devices
          console.log(`Devices: ${msg.devices} registerd to hub: ${hubID}`)
        }
      }
      if (msg.type == "confirmation") {
        const clientSocket = this.clientmanager.clientsockets[msg.clientID];
        if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
          clientSocket.send(JSON.stringify(msg));
        }
      }

    })
    socket.on('close', () => {
      console.log(`unregistering hub: ${hubID}`)
    // Kill any streams associated with this specific hub
      for (const streamKey in this.streammanager.runningstreams) {
        if (streamKey.startsWith(`${hubID}/`)) {
          const stream = this.streammanager.runningstreams[streamKey];
          
          // Close all browser connections for this stream
          stream.viewers.forEach(res => {
            if (!res.writableEnded) res.end();
          });

          // Close the hub-to-node stream socket
          if (stream.streamSocket.readyState === 1) stream.streamSocket.close();
          
          delete this.streammanager.runningstreams[streamKey];
        }
      }
	    delete this.hubs[hubID];
    })
  }
}

const hubmanager = new HubManager();
const clientmanager = new ClientManager(hubmanager);
const streammanager = new StreamManager(hubmanager);

hubmanager.clientmanager = clientmanager;
hubmanager.streammanager = streammanager;


wss.on('connection', async (ws, req) => {
  try {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const token = url.searchParams.get('token');
  
  if (!token) throw new Error("No token provided");
  
  // 2. Verify and extract user data
  const decoded = await verifyToken(token);
  const clientID = decoded.id; // Or whatever you named the payload field
  
  console.log(`Verified JWT connection for client: ${clientID}`);
  ws.once('message', (message) => {
      try {
        const msg = JSON.parse(message);
        console.log(`Connection initiated with message of type: ${msg.type} recieved`)
        if (msg.type == "init_conn") {
          if (msg.role == "py_server") {
            !Object.hasOwn(hubmanager.hubs, msg.hubID) ? hubmanager.add_socket(ws, msg.hubID, msg.devices) : console.log("hub already connected")
          } else if (msg.role == "client") {
            clientmanager.add_client(ws, msg.hubID, clientID)
          }
        } else if (msg.type == "init_stream") {
          const resolve = streammanager.pendingstreams[msg.socket_id];
          if (resolve) {
            resolve(ws);
          } else {
            console.error ("No pending stream for", msg.clientID);
          }
        } else {
          console.error("first message on websocket not of type 'init_conn' or 'init_stream'")
        }
      } catch (err) {
        console.error('Failed to parse first message:', err);
      }
    });
    } catch (err) {
      console.error('Auth failed:', err.message);
      ws.send(JSON.stringify({ type: 'error', data: 'Unauthorized' }));
      ws.close();
    }
})

app.get("/device_list", (req, res) => {
  try {
    let hubID = req.query.hubID
    if (hubmanager.hubs[hubID]) {
      res.json({ type: 'sync_data', data: hubmanager.hubs[hubID].devices , session: req.sessionID })
    } else {
      console.log(`hub ${hubID} is offline`)
      res.json({ type: 'sync_data', data: [], session: req.sessionID})
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: "Internal Server Error" });
  }
})



app.get("/stream", async (req, res) => {

  const { hubID, deviceID, token } = req.query;
  let clientID;
  try {
    // Synchronous or Async verification
    const decoded = jwt.verify(token, JWT_SECRET);
    clientID = decoded.userId;
  } catch (err) {
    console.error("Stream Auth Failed:", err.message);
    res.status(401).end();
  }

  res.removeHeader('ETag');
  
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Expires": "0",       // Proxies and older browsers
    "Connection": "close",
  });
  
  streammanager.add_viewer(res, hubID, deviceID, clientID);
  
  // When browser disconnects
  req.on("close", () => {
    streammanager.remove_viewer(res, hubID, deviceID, clientID);
  });
});


app.get("/get-token", (req, res) => {
  // Generate a unique ID for this guest
  const guestID = uuidv4(); 

  // Create the payload
  const payload = { 
    id: guestID,
    isGuest: true 
  };

  // Sign it (maybe set a shorter expiration for guests)
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

  res.json({ token, clientID: guestID });
});



server.listen(PORT, () => console.log(`Cloud relay running on port:${PORT}`));
