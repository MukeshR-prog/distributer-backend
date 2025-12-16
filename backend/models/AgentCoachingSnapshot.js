const mongoose = require('mongoose');

const agentCoachingSnapshotSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  generatedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  productivityScore: {
    type: Number,
    required: true
  },
  ranking: {
    teamRank: Number,
    departmentRank: Number,
    globalRank: Number,
    totalAgents: Number
  },
  strengths: [String],
  weaknesses: [String],
  recommendations: [
    {
      id: { type: String, required: true },
      text: { type: String, required: true }
    }
  ],
  goals: [
    {
      goal: { type: String, required: true },
      difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'easy' },
      estimatedImpact: { type: Number, default: 0 }
    }
  ],
  summary: {
    type: String,
    required: true
  },
  source: {
    type: String,
    enum: ['ai', 'fallback'],
    required: true
  },
  confidence: {
    type: String,
    enum: ['high', 'medium', 'low'],
    required: true
  },
  focusArea: {
    type: String
  },
  motivationMessage: {
    type: String
  }
}, {
  timestamps: { createdAt: 'generatedAt', updatedAt: false }
});

// Ensure sorting/lookups by agentId + generatedAt are performant
agentCoachingSnapshotSchema.index({ agentId: 1, generatedAt: -1 });

module.exports = mongoose.model('AgentCoachingSnapshot', agentCoachingSnapshotSchema);
