const mongoose = require('mongoose');

const riskSnapshotSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  riskScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 0
  },
  workload: {
    totalAssigned: {
      type: Number,
      required: true,
      default: 0
    },
    activeTasks: {
      type: Number,
      required: true,
      default: 0
    }
  },
  slaMetrics: {
    overdueCount: {
      type: Number,
      required: true,
      default: 0
    },
    approachingDeadlineCount: {
      type: Number,
      required: true,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Ensure a single snapshot per agent per day
riskSnapshotSchema.index({ agentId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('RiskSnapshot', riskSnapshotSchema);
