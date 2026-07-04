import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

if (!process.env.NODE_ENV) {
  dotenv.config({ path: '.env.production' })
}

const JWT_SECRET = process.env.JWT_SECRET;
const HUB_API_KEY = process.env.HUB_API_KEY;

// for ws auth
export const isValidToken = (token) => {
    jwt.verify(token, JWT_SECRET)
};

// auth for clients
export const authenticateToken = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    
    req.user = verified; 
    
    next();
  } catch (err) {
    console.log(err)
    res.status(403).json({ error: "Invalid or expired token." });
  }
};


// auth for hub servers
export const isValidHubKey = (incomingKey) => {    
    if (!incomingKey) return false;
    
    // Use a constant-time string comparison to prevent timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(incomingKey), 
        Buffer.from(SECURE_HUB_KEY)
    );
}