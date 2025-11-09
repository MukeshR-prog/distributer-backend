const mongoose = require('mongoose');

const aiInsightSnapshotSchema = new mongoose.Schema({
  insightType: {
    type: String,
    enum: ['insights', 'coaching', 'executive-summary'],
    required: true
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  generatedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  summary: {
    type: String,
    required: true
  },
  recommendations: [{
    recommendation: { type: String, required: true },
    reason: { type: String, required: true },
    supportingMetrics: { type: mongoose.Schema.Types.Mixed },
    priority: { type: String, enum: ['High', 'Medium', 'Low'], required: true }
  }],
  confidence: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  reasoning: {
    type: String,
    required: true
  },
  sourceMetrics: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  source: {
    type: String,
    enum: ['ai', 'fallback'],
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AIInsightSnapshot', aiInsightSnapshotSchema);
