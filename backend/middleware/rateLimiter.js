const rateLimit = require('express-rate-limit');

// General rate limiting
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes default
  max: 999999999, // globally high limit
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 1000)
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  trustProxy: false, // Disable proxy trust for local development
  skip: () => true, // Bypass rate limiting completely
});

// Strict rate limiting for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 999999999, // globally high limit
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again in 15 minutes.',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  trustProxy: false, // Disable proxy trust for local development
  skip: () => true, // Bypass rate limiting completely
});

// File upload rate limiting
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 999999999, // globally high limit
  message: {
    success: false,
    message: 'Too many file uploads, please wait before uploading again.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: false, // Disable proxy trust for local development
  skip: () => true, // Bypass rate limiting completely
});

// API rate limiting for data-heavy operations
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 999999999, // globally high limit
  message: {
    success: false,
    message: 'API rate limit exceeded, please slow down your requests.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: false, // Disable proxy trust for local development
  skip: () => true, // Bypass rate limiting completely
});

module.exports = {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  apiLimiter
};

