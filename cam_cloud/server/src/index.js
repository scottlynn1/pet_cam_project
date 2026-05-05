import express from "express"
import dotenv from 'dotenv';
import http from "http";
import cors from "cors";
import { WebSocketServer } from 'ws';
import fs from'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HubManager } from './managers/HubManager.js';
import { ClientManager } from './managers/ClientManager.js';
import { StreamManager } from './managers/StreamManager.js';
import { authenticateToken, verifyToken } from './middleware/auth.js';
import db, { seedDatabase } from './db/database.js';



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
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("FATAL: JWT_SECRET not found");
// Execute the seed
await seedDatabase().catch(err => {
  console.error("Seeding failed:", err);
});
// initialize express app, ws server, and middleware
const app = express();
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:5173', 'https://project4.scottlynn.live'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const hubmanager = new HubManager();
const clientmanager = new ClientManager(hubmanager);
const streammanager = new StreamManager(hubmanager);

hubmanager.clientmanager = clientmanager;
hubmanager.streammanager = streammanager;

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      console.log('Invalid username');
      return res.status(401).json({ error: "Invalid username" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      console.log('Invalid password');
      return res.status(401).json({ error: "Invalid password" });
    }

    const payload = { 
      id: user.id, 
      hub: user.hub 
    };
    
    const token = jwt.sign( payload, JWT_SECRET, { expiresIn: '6h' });
    
    res.json({ token });
  } catch (err) {
    console.log(`database error: ${err}`)
    return res.status(500).json({ error: err})
  }
});

app.get("/device_list", authenticateToken, (req, res) => {
  try {
    const hubID = req.user.hub;    
    if (hubmanager.hubs[hubID]) {
      res.json({ type: 'sync_data', data: hubmanager.hubs[hubID].devices })
    } else {
      console.log(`hub ${hubID} is offline`)
      //need to relay to front end that no hub is online rather than no devces connected to hub
      res.json({ type: 'sync_data', data: [] })
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: "Internal Server Error" });
  }
})

app.get("/stream", authenticateToken, async (req, res) => {

  const { deviceID } = req.query;
  const clientID = req.user.id;
  const hubID = req.user.hub;
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



wss.on('connection', async (ws, req) => {
  ws.once('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      console.log(`Connection initiated with message of type: ${msg.type} recieved`)
      if (msg.type == "init_conn") {
        if (msg.role == "py_server") {
          if (hubmanager.hubs[msg.hubID]) {
            hubmanager.hubs[msg.hubID].socket.close();
          }
          hubmanager.add_socket(ws, msg.hubID, msg.devices);
        } else if (msg.role == "client") {
          try {
            const url = new URL(req.url, `https://${req.headers.host}`);
            const token = url.searchParams.get('token');
            
            if (!token) throw new Error("No token provided");
            const decoded = await verifyToken(token);
            const clientID = decoded.id;
            const hub = decoded.hub;
            
            console.log(`Verified JWT connection for client: ${clientID}`);
            clientmanager.add_client(ws, hub, clientID)
          } catch (err) {
            if (err.name === 'TokenExpiredError') {
              console.error('User needs to log in again: Token expired.');
              ws.send(JSON.stringify({ type: 'error', error: err.name }));
            } else if (err.name === 'JsonWebTokenError') {
              console.error('Security alert: Invalid token format or signature.');
              ws.send(JSON.stringify({ type: 'error', error: err.name }));
            } else {
              console.error('Auth Error:', err.message);
            }
            ws.close();
            return
          }
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


server.listen(PORT, () => console.log(`Cloud relay running on port:${PORT}`));
