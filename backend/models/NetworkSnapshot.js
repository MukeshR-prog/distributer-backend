const mongoose = require('mongoose');

const networkSnapshotSchema = new mongoose.Schema({
  collaborationScore: {
    type: Number,
    required: true
  },
  knowledgeFlowScore: {
    type: Number,
    required: true
  },
  engagementScore: {
    type: Number,
    required: true
  },
  influenceScore: {
    type: Number,
    required: true
  },
  departmentMetrics: [
    {
      departmentName: { type: String, required: true },
      communicationDensity: { type: Number, required: true },
      collaborationVolume: { type: Number, required: true }
    }
  ],
  riskMetrics: {
    isolatedUsersCount: { type: Number, default: 0 },
    knowledgeSilosCount: { type: Number, default: 0 },
    communicationBottlenecksCount: { type: Number, default: 0 }
  },
  generatedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: { createdAt: 'generatedAt', updatedAt: false }
});

module.exports = mongoose.model('NetworkSnapshot', networkSnapshotSchema);
