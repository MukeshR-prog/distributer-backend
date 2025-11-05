const mongoose = require('mongoose');

const performanceSnapshotSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  weekStartDate: {
    type: Date,
    required: true
  },
  metrics: {
    completionRate: {
      type: Number,
      required: true,
      default: 0
    },
    slaComplianceRate: {
      type: Number,
      required: true,
      default: 0
    },
    averageResolutionTime: {
      type: Number,
      required: true,
      default: 0
    },
    overduePercentage: {
      type: Number,
      required: true,
      default: 0
    },
    criticalTaskHandlingRate: {
      type: Number,
      required: true,
      default: 0
    },
    activityParticipationRate: {
      type: Number,
      required: true,
      default: 0
    },
    performanceScore: {
      type: Number,
      required: true,
      default: 0
    },
    grade: {
      type: String,
      required: true
    }
  }
}, {
  timestamps: true
});

// Compound unique index to prevent duplicate weekly snapshots per agent
performanceSnapshotSchema.index({ agentId: 1, weekStartDate: 1 }, { unique: true });

module.exports = mongoose.model('PerformanceSnapshot', performanceSnapshotSchema);
