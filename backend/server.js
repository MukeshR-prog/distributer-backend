const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
require('dotenv').config();

// Import utilities and middleware
const connectDB = require('./config/database');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimiter');
const { cleanupOldFiles } = require('./utils/upload');

// Import routes
const authRoutes = require('./routes/auth');
const agentRoutes = require('./routes/agents');
const agentRoutesNew = require('./routes/agentsNew');
const distributionRoutes = require('./routes/distributions');
const distributionRoutesNew = require('./routes/distributionsNew');
const dashboardRoutes = require('./routes/dashboard');
const analyticsRoutes = require('./routes/analytics');
const reportRoutes = require('./routes/reports');
const activityRoutes = require('./routes/activity');
const auditRoutes = require('./routes/audit');
const aiRoutes = require('./routes/ai');
const automationRoutes = require('./routes/automation');
const { initializeAutomationEngine } = require('./services/automationEngine');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Make io accessible in routes
app.set('io', io);

// Connect to database
connectDB();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
// app.use(cors({
//   origin: process.env.FRONTEND_URL || "http://localhost:3000",
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization']
// }));
// CORS configuration - Allow all methods and origins for development
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // For development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    // For production, specify allowed origins
    const allowedOrigins = ['http://localhost:3000', 'http://localhost:3001'];
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200 // for legacy browser support
}));

// Handle preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});
// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
app.use(generalLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutesNew);  // Updated to use new agent routes
app.use('/api/distributions', distributionRoutesNew);  // Updated to use new distribution routes
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/automation', automationRoutes);

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Advanced MERN Distribution System API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      agents: '/api/agents',
      distributions: '/api/distributions',
      dashboard: '/api/dashboard'
    },
    documentation: 'https://github.com/MukeshR-prog/distributer-backend'
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // Join user to their role-based room
  socket.on('join', (data) => {
    const { userId, role } = data;
    socket.join(`${role}_${userId}`);
    socket.join(role); // Join role-based room
    console.log(`👤 User ${userId} joined ${role} room`);
  });

  // Handle real-time updates
  socket.on('taskUpdate', (data) => {
    // Broadcast task updates to relevant users
    socket.broadcast.emit('taskUpdated', data);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.id}`);
  });
});

// Scheduled tasks
// Clean up old uploaded files daily at 2 AM
cron.schedule('0 2 * * *', () => {
  console.log('🧹 Running scheduled file cleanup...');
  cleanupOldFiles();
});

// Create admin user on server start (development only)
if (process.env.NODE_ENV === 'development') {
  setTimeout(async () => {
    try {
      const User = require('./models/User');
      const existingAdmin = await User.findOne({ 
        email: process.env.ADMIN_EMAIL,
        role: 'admin' 
      });

      if (!existingAdmin) {
        await User.create({
          name: process.env.ADMIN_NAME || 'System Administrator',
          email: process.env.ADMIN_EMAIL,
          password: process.env.ADMIN_PASSWORD,
          role: 'admin',
          isActive: true
        });
        console.log('✅ Admin user created automatically');
      }
    } catch (error) {
      console.log('⚠️  Admin user creation skipped:', error.message);
    }
  }, 2000);
}

// Error handling middleware (must be last)
app.use(notFound);
app.use(errorHandler);

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.error('🚨 Unhandled Promise Rejection:', err.message);
  console.error('Stack:', err.stack);
  
  // Close server & exit process
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('🚨 Uncaught Exception:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    mongoose.connection.close();
    console.log('✅ Process terminated');
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`
🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}
📊 Database: MongoDB
🔐 Authentication: JWT
📡 Real-time: Socket.IO
🛡️  Security: Helmet, CORS, Rate Limiting
📈 Monitoring: Morgan, Health Check
  `);
  initializeAutomationEngine(io);
});
