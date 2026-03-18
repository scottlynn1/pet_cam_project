import express from "express"
import session from "express-session"
import dotenv from 'dotenv';
import http from "http";
import cors from "cors";

import { WebSocketServer } from 'ws';
const env = process.env.NODE_ENV || 'development';
dotenv.config({
  path: `.env.${env}`,
});
const PORT = parseInt(process.env.PORT);
const app = express();
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const sessionParser = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: !!process.env.SECURE, httpOnly: true }
});
console.log(!!process.env.SECURE)
app.use(sessionParser);
const { promise, resolve, reject } = Promise.withResolvers();


class ClientManager {
  constructor(hubmanager) {
    this.clientIDs = {};
    this.hubmanager = hubmanager
  }
  //need to finish websocket with listeners
  addClient(ws, clientID) {
    this.clientIDs[clientID] = ws;
    ws.on("message", (message) => {
      const msg = JSON.parse(message);
      if (msg.type === "servo_cmd" || msg.type == "laser_cmd") {
        const pyserver = this.hubmanager.hubID.socket
        pyserver.send(JSON.stringify(msg));
      }})
  }
  removeClient(clientID) {
    delete this.clientIDs[clientID];
  }
}


class StreamManager {
  constructor(hubmanager, clientmanager) {
    this.hubmanager = hubmanager
    this.clientmanager = clientmanager
    this.runningstreams = {}
  }
  async add_viewer(res, hubID, deviceID) {
    console.log(`Browser connecting to stream: ${deviceID}`);
    if (!this.runningstreams.includes(`${hubID}/${deviceID}`)) {
      await this.start_stream(res)
    } else {
      this.runningstreams[`${hubID}/${deviceID}`] = [...this.runningstreams[`${hubID}/${deviceID}`], res]
    }
  }

  async start_stream(res) {
    await this.hubmanager.hubID.cmd_socket.send(JSON.stringify({ type: 'init_stream', role: "node_server", device: deviceID}))
    // race condition here with not knowing which stream socket gets returned
    const ws = await promise
    this.hubmanager.hubs[hubID].stream_sockets.push(ws)

    this.runningstreams[`${hubID}/${deviceID}`] = [res]

    ws.on("message", () => {
      let clients = this.runningstreams[`${hubID}/${deviceID}`]
      for (let client of clients) {
        if (client.writableEnded) return
        client.write(message);
      }
    });
  }
  remove_viewer(res, hubID, deviceID, clientID) {
    const client_ws = this.clientmanager[clientID]
    const pyserver = this.hubmanager.hubs[hubID].socket
    stream_socket.off("message", forwarder);
    console.log(`Browser disconnected from stream ${deviceID}`);
    // Optional: tell Pi to stop streaming
    cmd_socket.send(JSON.stringify({ cmd: "stop_stream", deviceID }));
  }

}


  

class HubManager {
  constructor() {
    this.hubs = {}
  }
  add_socket(socket, hubID, devices) {
    socket.on("message", (message) => {
      const msg = JSON.parse(message);
      if (msg.type == "sync_data") {
        this.hubs[msg.hubID].devices = msg.devices
      }

    })
    this.hubs[hubID] = {
      devices: devices,
      cmd_socket: socket,
      stream_sockets: []
    }
  }
  add_stream_socket(socket, hubID, device) {
    this.hubs[hubID].stream_sockets.push(socket)
  }
}


wss.on('connection', (ws, req) => {
  console.log('ws connection made')
  ws.once('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type == "init_conn") {
        if (msg.role == "py_server") {
          hubmanager.list().includes(msg.hubID) ? hubmanager.add_cmd_socket(ws, msg.hubID, msg.devices) : console.log("hub already connected")
        } else if (msg.role == "client") {
          let clientID;
          sessionParser(req, {}, () => {
            console.log('Session ID:', req.sessionID);     
            clientID = req.sessionID
            if (!req.sessionID) {
                console.log("No session found for this connection.");
            }})
          ClientManager.add_client(ws, clientID)
        }
      } else if (msg.type == "init_stream") {
        resolve(ws)
        hubmanager.add_stream_socket(ws, msg.hubID, msg.device)
      } else {
        console.error("first message on websocket not of type 'init_conn' or 'init_stream'")
      }
    } catch (err) {
      console.error('Failed to parse first message:', err);
    }
  });  
})

app.get("/device_list", (req, res) => {
  try {
    res.json({ type: 'sync_data', data: hubmanager.hubID.devices , session: req.sessionID})
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: "Internal Server Error" });
  }
})

app.get("/stream", (req, res) => {
  const deviceID = req.query.streamId;
  const hubID = req.query.hubID;
  let clientID
  sessionParser(req, {}, () => {
    console.log('Session ID:', req.sessionID); 
    // Now req.sessionID and req.session will be populated!
    clientID = req.sessionID
    if (!req.sessionID) {
        console.log("No session found for this connection.");
    }})
    // if (!pyserver || pyserver.readyState !== WebSocket.OPEN) {
      //   return res.status(503).send("Stream not available");
      // }
      
  res.removeHeader('ETag');
  
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Expires": "0",       // Proxies and older browsers
    "Connection": "close",
  });
  
  StreamManager.add_viewer(res, hubID, deviceID, clientID);
  
  // When browser disconnects
  req.on("close", () => {
    StreamManager.remove_viewer(res, hubID, deviceID, clientID);
  });
});



server.listen(PORT, () => console.log(`Cloud relay running on port:${PORT}`));
