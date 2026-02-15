import express from "express"
const app = express();
import dotenv from 'dotenv';
const env = process.env.NODE_ENV || 'development';
dotenv.config({
  path: `.env.${env}`,
});
const PORT = parseInt(process.env.PORT);
import { WebSocketServer } from 'ws';
const server = app.listen(PORT, () => console.log(`Cloud relay running on port:${PORT}`));
const wss = new WebSocketServer({ httpServer: server });

let pyserver = null

wss.on('connection', (ws) => {
  console.log('Client connected')
  
  ws.on('message', (message) => {
    let msg = JSON.parse(message)
    console.log('Received of type', msg.type);

    if (msg.type === "init") {
      if (msg.role === "python") {
        if (pyserver) {
          console.log('pyserver already connected')
          ws.send(JSON.stringify({ type: 'error', server: 'node-01' }))
          return
        } else {
          pyserver = ws
          console.log("Python registered");
          ws.send(JSON.stringify({ type: 'welcome', server: 'node-01'}));
        }
      } else {
        console.log("frontend connected")
        ws.send(JSON.stringify({ type: 'welcome', server: 'node-01'}))
      }
      return
    }

    if (msg.type === "data-point") {
      let msg = JSON.parse(message)
      console.log('Received data-point', msg.data);
      if (!pyserver) {
        console.log('no pyserver connection to relay to')
      } else {
        pyserver.send(JSON.stringify({ data: msg.data}));
      }
    }
  })
})

app.get("/camera/:streamId", (req, res) => {
  const streamId = req.params.streamId;

  if (!pyserver || pyserver.readyState !== WebSocket.OPEN) {
    return res.status(503).send("Stream not available");
  }

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache",
    "Connection": "close",
  });

  console.log(`Browser connected to stream: ${streamId}`);

  // Forward MJPEG bytes from Pi to browser
  const forwarder = (data) => {
    if (res.writableEnded) return;
    res.write(data); // write raw bytes directly
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



console.log("Index.js started");
