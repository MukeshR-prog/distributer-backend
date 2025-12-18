const mongoose = require('mongoose');

const achievementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['sla', 'streaks', 'completion', 'productivity', 'general'],
    required: true
  },
  criteria: {
    type: {
      type: String,
      enum: ['task_completion', 'sla_compliance', 'streak_count', 'productivity_score'],
      required: true
    },
    threshold: {
      type: Number,
      required: true
    }
  },
  pointsReward: {
    type: Number,
    default: 100
  },
  badgeIcon: {
    type: String,
    default: 'award' // 'flame' | 'shield' | 'check' | 'star' | 'trophy'
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Achievement', achievementSchema);
