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
    delete this.clientIDs.clientID;
  }
}

class StreamManager {
  constructor(hubmanager) {
    this.hubmanager = hubmanager
    this.runningstreams = {}
  }
  async add_viewer(res, clientID, hubID, deviceID) {
    console.log(`Browser connecting to stream: ${deviceID}`);

    await this.hubmanager.hubID.devices[].send(JSON.stringify({ type: 'init_stream', role: "node_server", target: deviceID}))
    
    // Forward MJPEG bytes from Pi to browser
    const forwarder = (message) => {
      if (res.writableEnded) return;
      if (message[0] !== 0x7B) {
        // res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${message.length}\r\n\r\n`);
        res.write(message);
        // res.write('\r\n');
      }
    };
    
    // Listen for binary frames
    pyserver.on("message", forwarder);
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
      socket: socket
    }
  }
}


wss.on('connection', (ws, req) => {
  console.log('ws connection made')
  ws.once('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type == "init_conn") {
        if (msg.role == "py_server") {
          HubManager.list().includes(msg.hubID) ? HubManager.add_socket(ws, msg.hubID, msg.devices) : console.log("hub already connected")
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
        StreamManager.a
      } else {
        console.error("first message on websocket not of type 'init_conn' or 'init_stream'")
      }
    } catch (err) {
      console.error('Failed to parse first message:', err);
    }
  });





  ws.on("close", () => {

  });
  
  ws.on('message', (message) => {
    if (message[0] !== 0x7B) {
      // Do NOT JSON.parse this
      // Streaming logic handles this elsewhere
      return;
    }

    let msg = JSON.parse(message)
    console.log('Received message of type', msg.type);

    if (msg.type === "servo_cmd") {
      console.log('Received data-point', msg.data);
      if (!pyserver) {
        console.log('no pyserver connected')
      } else {
        pyserver.send(JSON.stringify({ type: "servo_cmd", role: "node_server", data: msg.data, target: msg.target}));
      }
      return
    }

    if (msg.type === "laser_cmd") {
      if (!pyserver) {
        console.log('no pyserver connected')
      } else {
        pyserver.send(JSON.stringify({ type: "laser_cmd", role: "node_server", data: msg.data, target: msg.target}))
      }
      return
    }
  })
})

app.get("/device_list", (req, res) => {
  try {
    res.json({ type: 'sync_data', data: [1, 2, 3] , session: req.sessionID})
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: "Internal Server Error" });
  }
})

app.get("/stream", (req, res) => {
  const deviceID = req.query.streamId;
  const hubID =req.query.hubID;
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
  
  StreamManager.add_viewer(res, clientID, hubID, deviceID)

  
  // When browser disconnects
  req.on("close", () => {
    FeedManager.remove_viewer();
    pyserver.off("message", forwarder);
    console.log(`Browser disconnected from stream ${deviceID}`);
    // Optional: tell Pi to stop streaming
    pyserver.send(JSON.stringify({ cmd: "stop_stream", deviceID }));
  });
});



server.listen(PORT, () => console.log(`Cloud relay running on port:${PORT}`));
