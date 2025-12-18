const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  actionType: {
    type: String,
    enum: ['AGENT_CREATED', 'AGENT_DELETED', 'DISTRIBUTION_UPLOADED', 'REPORT_GENERATED', 'STATUS_UPDATED', 'AGENT_ANALYTICS_VIEWED', 'PERFORMANCE_REPORT_VIEWED', 'ACHIEVEMENT_UNLOCKED', 'LEVEL_UP', 'STREAK_CREATED'],
    required: [true, 'Action type is required']
  },
  entityType: {
    type: String,
    enum: ['User', 'Distribution', 'Report', 'Record'],
    required: [true, 'Entity type is required']
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'Entity ID is required']
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Performed by user reference is required']
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);
