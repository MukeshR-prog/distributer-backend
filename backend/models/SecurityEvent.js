const mongoose = require('mongoose');

const securityEventSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: [true, 'Event type is required'],
    enum: [
      'Login Success',
      'Login Failure',
      'Password Change',
      'Agent Creation',
      'Permission Changes',
      'Role Updates',
      'Automation Changes'
    ]
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  severity: {
    type: String,
    required: [true, 'Severity is required'],
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

// Indexes for query performance
securityEventSchema.index({ eventType: 1 });
securityEventSchema.index({ severity: 1 });
securityEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SecurityEvent', securityEventSchema);
