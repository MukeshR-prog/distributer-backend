const mongoose = require('mongoose');

const agentPerformanceSnapshotSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  generatedAt: {
    type: Date,
    required: true
  },
  productivityScore: {
    type: Number,
    required: true
  },
  completionRate: {
    type: Number,
    required: true
  },
  slaCompliance: {
    type: Number,
    required: true
  },
  completedTasks: {
    type: Number,
    required: true
  },
  rank: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

// Compound unique index to prevent duplicate daily/weekly snapshots per agent
agentPerformanceSnapshotSchema.index({ agentId: 1, generatedAt: 1 }, { unique: true });

module.exports = mongoose.model('AgentPerformanceSnapshot', agentPerformanceSnapshotSchema);
