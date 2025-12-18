const mongoose = require('mongoose');

const agentAchievementSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  achievementId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Achievement',
    required: true
  },
  currentValue: {
    type: Number,
    default: 0
  },
  targetValue: {
    type: Number,
    required: true
  },
  progressPercent: {
    type: Number,
    default: 0
  },
  isUnlocked: {
    type: Boolean,
    default: false,
    index: true
  },
  unlockedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Compound index to ensure single progress tracker record per agent-achievement pair
agentAchievementSchema.index({ agentId: 1, achievementId: 1 }, { unique: true });

module.exports = mongoose.model('AgentAchievement', agentAchievementSchema);
