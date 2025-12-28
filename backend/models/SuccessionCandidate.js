const mongoose = require('mongoose');

const successionCandidateSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  targetRole: {
    type: String,
    required: true,
    index: true
  },
  readinessScore: {
    type: Number,
    required: true,
    index: true
  },
  leadershipScore: {
    type: Number,
    required: true
  },
  successionTier: {
    type: String,
    required: true,
    enum: ['Emerging Leader', 'Leadership Ready', 'High Potential', 'Strategic Successor']
  },
  strengths: {
    type: [String],
    default: []
  },
  developmentAreas: {
    type: [String],
    default: []
  },
  influenceScore: {
    type: Number,
    default: 15
  },
  isInfluencerRecommended: {
    type: Boolean,
    default: false
  },
  recommendationReason: {
    type: String,
    required: true
  },
  estimatedReadinessDate: {
    type: Date
  },
  generatedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: { createdAt: 'generatedAt', updatedAt: false }
});

successionCandidateSchema.index({ agentId: 1, generatedAt: -1 });

module.exports = mongoose.model('SuccessionCandidate', successionCandidateSchema);
