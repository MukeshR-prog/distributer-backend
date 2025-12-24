const mongoose = require('mongoose');

const weeklyPlanItemSchema = new mongoose.Schema({
  week: {
    type: Number,
    required: true
  },
  action: {
    type: String,
    required: true
  }
}, { _id: false });

const careerProgressionSnapshotSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  readinessScore: {
    type: Number,
    required: true
  },
  readinessLevel: {
    type: String,
    required: true,
    enum: ['Emerging Talent', 'Developing', 'Promotion Ready', 'High Potential']
  },
  currentRole: {
    type: String,
    required: true
  },
  nextRole: {
    type: String,
    required: true
  },
  strengths: {
    type: [String],
    default: []
  },
  improvementAreas: {
    type: [String],
    default: []
  },
  completedRequirements: {
    type: [String],
    default: []
  },
  pendingRequirements: {
    type: [String],
    default: []
  },
  missingSkills: {
    type: [String],
    default: []
  },
  recommendedCertifications: {
    type: [String],
    default: []
  },
  leadershipGoals: {
    type: [String],
    default: []
  },
  weeklyImprovementPlan: [weeklyPlanItemSchema],
  estimatedPromotionDate: {
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

// Compound index for quick sorting by agent and date
careerProgressionSnapshotSchema.index({ agentId: 1, generatedAt: -1 });

module.exports = mongoose.model('CareerProgressionSnapshot', careerProgressionSnapshotSchema);
