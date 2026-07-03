import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.production' })
const JWT_SECRET = process.env.JWT_SECRET;
const HUB_API_KEY = process.env.HUB_API_KEY;
//need to add blacklisting of old tokens due to stale data from db updates

// for ws auth
export const isValidToken = (token) => {
    jwt.verify(token, JWT_SECRET)
};

// for auth on all other routes as middleware

export const authenticateToken = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    // 2. Verify the token
    const verified = jwt.verify(token, JWT_SECRET);
    
    // 3. Attach the user data to the request object for later use
    req.user = verified; 
    
    // 4. Move to the next piece of logic
    next();
  } catch (err) {
    console.log("Invalid or expired token.")
    res.status(403).json({ error: "Invalid or expired token." });
  }
};

export const isValidHubKey = (incomingKey) => {    
    if (!incomingKey) return false;
    
    // Use a constant-time string comparison to prevent timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(incomingKey), 
        Buffer.from(SECURE_HUB_KEY)
    );
}