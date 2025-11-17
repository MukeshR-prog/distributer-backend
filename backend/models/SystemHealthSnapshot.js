const mongoose = require('mongoose');

const systemHealthSnapshotSchema = new mongoose.Schema({
  generatedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  apiResponseTime: {
    type: Number,
    required: true,
    min: 0
  },
  activeUsers: {
    type: Number,
    required: true,
    min: 0
  },
  taskThroughput: {
    type: Number,
    required: true,
    min: 0
  },
  automationHealth: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  aiServiceHealth: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SystemHealthSnapshot', systemHealthSnapshotSchema);
