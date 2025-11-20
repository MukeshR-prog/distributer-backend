const mongoose = require('mongoose');

const capacitySnapshotSchema = new mongoose.Schema({
  generatedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  activeAgents: {
    type: Number,
    required: true,
    min: 0
  },
  activeTasks: {
    type: Number,
    required: true,
    min: 0
  },
  workloadRatio: {
    type: Number,
    required: true,
    min: 0
  },
  slaCompliance: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  riskScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  utilizationRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  workforceEfficiencyScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CapacitySnapshot', capacitySnapshotSchema);
