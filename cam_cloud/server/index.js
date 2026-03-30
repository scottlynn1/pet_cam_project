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
app.use(sessionParser);


class ClientManager {
  constructor(hubmanager) {
    this.clientIDs = {};
    this.hubmanager = hubmanager
  }
  //need to finish websocket with listeners
  add_client(ws, hubID, clientID) {
    this.clientIDs[clientID] = ws;
    ws.on("message", (message) => {
      const msg = JSON.parse(message);
      if (msg.type === "servo_cmd" || msg.type == "laser_cmd") {
	console.log(msg)
        const pyserver = this.hubmanager.hubs[hubID].socket
        msg["clientID"] = clientID
        pyserver.send(JSON.stringify(msg));
      }
    }) 
    ws.on("close", () => {
      delete this.clientIDs[clientID];
    })
  }
}
 
  class StreamManager {
    constructor(hubmanager) {
      this.runningstreams = {}
      this.hubmanager = hubmanager
      this.pendingstreams = {}
    }
    
    async add_viewer(res, hubID, deviceID, clientID) {
      console.log(`Browser connecting to stream: ${deviceID}`);
      let stream = `${hubID}/${deviceID}`
      // minor race condition here with starting multiple streams
      if (!Object.hasOwn(this.runningstreams, stream)) {
        await this.start_stream(res, hubID, deviceID, clientID)
      } else {
        this.runningstreams[stream].viewers.add(res)
      }
    }
    
    async start_stream(res, hubID, deviceID, clientID) {
      let stream = `${hubID}/${deviceID}`
      const { promise, resolve } = Promise.withResolvers();
      const requestId = `${clientID}-${Date.now()}`
      this.pendingstreams[requestId] = resolve
      this.hubmanager.hubs[hubID].socket.send(JSON.stringify({ type: 'init_stream', role: "node_server", device: deviceID, socket_id: requestId}))
      // race condition here with not knowing which stream socket gets returned
      let ws = await promise
      delete this.pendingstreams[requestId];
      this.runningstreams[stream] = { streamSocket: ws, viewers: new Set([res]) }

      ws.on("message", (message) => {
        let clients = this.runningstreams[stream].viewers
        for (let client of clients) {
          if (client.writableEnded) {
            clients.delete(client);
            continue;
          }
          client.write(message);
        }
      });
  }

  remove_viewer(res, hubID, deviceID) {
    let stream = `${hubID}/${deviceID}`
    const s = this.runningstreams[stream]
    if (!s) return
    s.viewers.delete(res);
    if (!s.viewers.size) {
      s.streamSocket.close()
      delete this.runningstreams[stream]
    }
  }

}


  

class HubManager {
  constructor(clientmanager) {
    this.hubs = {};
    this.clientmanager = clientmanager;
  }

  add_socket(socket, hubID, devices) {
    console.log(typeof hubID)
    this.hubs[hubID] = {
        devices: devices,
        socket
    }
    socket.on("message", (message) => {
      const msg = JSON.parse(message);
      console.log(msg);
      if (msg.type == "sync_data") {
	console.log(typeof msg.hubID);
        this.hubs[msg.hubID].devices = msg.devices
      }
      if (msg.type == "confirmation") {
        this.clientmanager.clientIDs[msg.clientID].send(JSON.stringify( msg ))
      }

    })
    socket.on('close', () => {
	delete this.hubs[hubID];
    })
  }
}

const hubmanager = new HubManager();
const clientmanager = new ClientManager(hubmanager);
const streammanager = new StreamManager(hubmanager);

hubmanager.clientmanager = clientmanager;

wss.on('connection', (ws, req) => {
  console.log('ws connection made')
  ws.once('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type == "init_conn") {
        if (msg.role == "py_server") {
          !Object.hasOwn(hubmanager.hubs, msg.hubID) ? hubmanager.add_socket(ws, msg.hubID, msg.devices) : console.log("hub already connected")
        } else if (msg.role == "client") {
          let clientID;
          sessionParser(req, {}, () => {
            console.log('Session ID:', req.sessionID);     
            clientID = req.sessionID
            if (!req.sessionID) {
                console.log("No session found for this connection.");
            }})
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
})

app.get("/device_list", (req, res) => {
  try {
    let hubID = req.query.hubID
    res.json({ type: 'sync_data', data: hubmanager.hubs[hubID].devices , session: req.sessionID })
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: "Internal Server Error" });
  }
})

const runSession = (req, res) => {
  return new Promise((resolve, reject) => {
    sessionParser(req, res, (err) => {
      if (err) return reject(err);
      console.log(req.session(ID));
      resolve(req.session(ID));
    });
  });
};

app.get("/stream", async (req, res) => {
  const deviceID = req.query.streamId;
  const hubID = req.query.hubID;
  let clientID = await runSession(req, res);
      
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
    streammanager.remove_viewer(res, hubID, deviceID);
  });
});



server.listen(PORT, () => console.log(`Cloud relay running on port:${PORT}`));
