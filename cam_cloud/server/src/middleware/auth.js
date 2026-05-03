import jwt from 'jsonwebtoken';

//need to add blacklisting of old tokens due to stale data from db updates

// for ws auth
export const verifyToken = (token) => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
};

// for auth on all other routes as middleware

export const authenticateToken = (req, res, next) => {
  const token = req.query.token;
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
    res.status(403).json({ error: "Invalid or expired token." });
  }
};