const mongoose = require('mongoose');

const coachingActionSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  recommendationId: {
    type: String,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['completed', 'dismissed', 'saved', 'pending'],
    default: 'pending'
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Ensure a single state mapping for each agent-recommendation pair
coachingActionSchema.index({ agentId: 1, recommendationId: 1 }, { unique: true });

module.exports = mongoose.model('CoachingAction', coachingActionSchema);
