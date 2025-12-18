const mongoose = require('mongoose');

const challengeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['daily', 'weekly'],
    required: true
  },
  targetType: {
    type: String,
    enum: ['task_completion', 'sla_compliance', 'critical_resolution'],
    required: true
  },
  threshold: {
    type: Number,
    required: true
  },
  xpReward: {
    type: Number,
    default: 100
  },
  pointsReward: {
    type: Number,
    default: 50
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Challenge', challengeSchema);
