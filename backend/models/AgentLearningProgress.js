const mongoose = require('mongoose');

const agentLearningProgressSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  pathId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningPath',
    required: true,
    index: true
  },
  moduleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningModule',
    required: true,
    index: true
  },
  completionPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  quizScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  timeSpent: {
    type: Number,
    default: 0 // in minutes
  }
}, {
  timestamps: true
});

// Ensure quick lookup for agent + path/module combos
agentLearningProgressSchema.index({ agentId: 1, pathId: 1 });
agentLearningProgressSchema.index({ agentId: 1, moduleId: 1 }, { unique: true });

module.exports = mongoose.model('AgentLearningProgress', agentLearningProgressSchema);
