const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  week: {
    type: Number,
    required: true
  },
  goals: {
    type: [String],
    required: true
  },
  status: {
    type: String,
    enum: ['upcoming', 'in-progress', 'completed'],
    default: 'upcoming'
  }
});

const developmentPlanSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  currentLevel: {
    type: String,
    required: true
  },
  targetLevel: {
    type: String,
    required: true
  },
  recommendedSkills: {
    type: [String],
    default: []
  },
  recommendedCourses: {
    type: [String],
    default: []
  },
  estimatedCompletionWeeks: {
    type: Number,
    default: 4
  },
  milestones: [milestoneSchema],
  strengths: {
    type: [String],
    default: []
  },
  skillGaps: {
    type: [String],
    default: []
  },
  careerSuggestions: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'archived'],
    default: 'active',
    index: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('DevelopmentPlan', developmentPlanSchema);
