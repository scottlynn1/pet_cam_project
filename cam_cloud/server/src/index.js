import express from "express"
import dotenv from 'dotenv';
import http from "http";
import cors from "cors";
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HubManager } from './managers/HubManager.js';
import { ClientManager } from './managers/ClientManager.js';
import { StreamManager } from './managers/StreamManager.js';
import { authenticateToken, isValidToken } from './middleware/auth.js';
import db, { seedDatabase } from './db/database.js';
import { v4 } from 'uuid';
import { rateLimit } from 'express-rate-limit';
import { cookie } from 'cookie'
import cookieParser from 'cookie-parser';


// set up development or production env vars
if (!process.env.NODE_ENV) {
  dotenv.config({
    path: `.env.development`,
  });
}
const PORT = parseInt(process.env.PORT);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("FATAL: JWT_SECRET not found");
// Execute the seed
await seedDatabase().catch(err => {
  console.error("Seeding failed:", err);
});
// initialize express app, ws server, and middleware
const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:5173', 'https://project4.scottlynn.live'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  keyGenerator: (req) => {
    return req.body.username || req.ip; 
  },
  message: {
    success: false,
    error: "Too many login attempts. Please try again after 15 minutes."
  },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Intercept the HTTP Upgrade request before it becomes a WebSocket
server.on('upgrade', (request, socket, head) => {
  // Extract cookies from the handshake headers
  const headers = request.headers;


  const cookies = cookie.parse(headers.cookie || '');
  const clientToken = cookies?.auth_token;
  const hubApiKey = headers['x-hub-api-key'];

  let isAuthenticated = false;
  let connectionType = null;

  if (clientToken) {
    try {
      const decoded = isValidToken(clientToken);
      request.decodedKey = decoded
      connectionType = "client"
    } catch (err) {
      console.log("WebSocket Upgrade rejected: Client token was invalid or expired.");
    }
  } else if (hubApiKey && isValidHubKey(hubApiKey)) {
    isAuthenticated = true;
    connectionType = "hub"
  }
  if (!isAuthenticated) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  request.connectionType = connectionType;
  
  // Complete the upgrade if valid
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', async (ws, req) => {
  ws.once('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      console.log(`Connection initiated with message of type: ${msg.type} recieved`)
      if (req.connectionType == "hub") {
        if (msg.type = "init_conn") {
          if (hubmanager.hubs[msg.hubID]) {
            hubmanager.hubs[msg.hubID].socket.close();
          }
          hubmanager.add_socket(ws, msg.hubID, msg.devices);
        } else if (msg.type = "init_stream") {
          const resolve = streammanager.pendingstreams[msg.socket_id];
          if (resolve) {
            resolve(ws);
          } else {
            console.error ("No pending stream for", msg.clientID);
          }
        }
      } else if (req.connectionType == "client") {
        try {
          const decoded = req.decodedKey;
          const clientID = decoded.client_id;
          const hub = decoded.hub;
          console.log(`Verified JWT connection for client: ${clientID}`);
          clientmanager.add_client(ws, hub, clientID)
        } catch (err) {
          console.error(err.message);
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
      }
    } catch (err) {
      console.error('Failed to parse first message:', err);
    }
  });
})


const hubmanager = new HubManager();
const clientmanager = new ClientManager(hubmanager);
const streammanager = new StreamManager(hubmanager);

hubmanager.clientmanager = clientmanager;
hubmanager.streammanager = streammanager;

app.post('/login', loginLimiter, async (req, res) => {
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
      client_id: v4(),
      hub: user.hub 
    };
    
    const token = jwt.sign( payload, JWT_SECRET, { expiresIn: '6h' });

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
        maxAge: 1 * 60 * 60 * 1000,
        path: '/'
    });
    
    res.json({ success: true });
  } catch (err) {
    console.log(`database error: ${err}`)
    return res.status(500).json({ error: err})
  }
});

app.get("/auth_status", authenticateToken, (req, res) => {
  res.json({ loggedIn: true });
})

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





server.listen(PORT, () => console.log(`Cloud relay running on port:${PORT}`));
