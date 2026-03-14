import express from "express"
import dotenv from 'dotenv';
import http from "http";

import { WebSocketServer } from 'ws';
const env = process.env.NODE_ENV || 'development';
dotenv.config({
  path: `.env.${env}`,
});
const PORT = parseInt(process.env.PORT);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let pyserver = null
let devices = []

wss.on('connection', (ws) => {
  console.log('Client connected')
  ws.on("close", () => {
    if (ws === pyserver) {
      console.log("Python server disconnected");
      pyserver = null;
    }
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
        console.log('no pyserver connection to relay to')
      } else {
        pyserver.send(JSON.stringify({ type: "servo_cmd", role: "node_server", data: msg.data, target: msg.target}));
      }
      return
    }

    if (msg.type === "init_conn") {
      if (msg.role === "py_server") {
        if (pyserver) {
          console.log('pyserver already connected')
          ws.send(JSON.stringify({ type: 'error', data: 'py_server already connected' }))
        } else {
          pyserver = ws
          pyserver.send(JSON.stringify({ type: "sync_data"}))
          console.log("Python registered");
        }
      } else if (msg.role === "client") {
        console.log("frontend connected")
        ws.send(JSON.stringify({ type: "data_sync", data: devices})) // need to add logic for device data
      }
    }
    if (msg.type === "data_sync") {
        if (msg.action === "add") {
          for (let data in msg.data) {
            devices.push(data)
          }
        } else if (msg.action === "remove") {
          for (let data in msg.data) {
            devices.pop(data)
          }
        }
      }
  })
})

app.get("/stream", (req, res) => {
  const streamId = req.query.streamId;
  
  if (!pyserver || pyserver.readyState !== WebSocket.OPEN) {
    return res.status(503).send("Stream not available");
  }

  res.removeHeader('ETag');
  
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Expires": "0",       // Proxies and older browsers
    "Connection": "close",
  });
  
  console.log(`Browser connected to stream: ${streamId}`);
  pyserver.send(JSON.stringify({ type: 'init_stream', role: "node_server", target: streamId}))
  
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
  
  // When browser disconnects
  req.on("close", () => {
    pyserver.off("message", forwarder);
    console.log(`Browser disconnected from stream ${streamId}`);
    // Optional: tell Pi to stop streaming
    pyserver.send(JSON.stringify({ cmd: "stop_stream", streamId }));
  });
});



server.listen(PORT, () => console.log(`Cloud relay running on port:${PORT}`));
