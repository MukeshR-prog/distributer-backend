const jwt = require('jsonwebtoken');

/**
 * Generate JWT token
 */
const generateToken = (id, rememberMe = false) => {
  const expiresIn = rememberMe ? '30d' : '24h';
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn
  });
};

/**
 * Verify JWT token
 */
const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

/**
 * Generate response with user data and token
 */
const generateAuthResponse = (user, message = 'Success', rememberMe = false) => {
  const token = generateToken(user._id, rememberMe);
  
  return {
    success: true,
    message,
    token,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        mobile: user.mobile,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        loginCount: user.loginCount,
        assignedTasks: user.assignedTasks,
        completedTasks: user.completedTasks,
        completionRate: user.completionRate,
        createdAt: user.createdAt
      }
    }
  };
};

/**
 * Extract token from request headers
 */
const extractTokenFromHeader = (req) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  return null;
};

/**
 * Generate password reset token
 */
const generateResetToken = () => {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Check if token is expired
 */
const isTokenExpired = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) return true;
    
    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  } catch (error) {
    return true;
  }
};

/**
 * Refresh token if it's close to expiry
 */
const refreshTokenIfNeeded = (token, refreshThreshold = 24 * 60 * 60) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) return null;
    
    const currentTime = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = decoded.exp - currentTime;
    
    // Refresh if token expires within the threshold (default: 24 hours)
    if (timeUntilExpiry < refreshThreshold) {
      return generateToken(decoded.id);
    }
    
    return null;
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateToken,
  verifyToken,
  generateAuthResponse,
  extractTokenFromHeader,
  generateResetToken,
  isTokenExpired,
  refreshTokenIfNeeded
};
