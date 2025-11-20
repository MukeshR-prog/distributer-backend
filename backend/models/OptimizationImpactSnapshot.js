const mongoose = require('mongoose');

const optimizationImpactSnapshotSchema = new mongoose.Schema({
  recommendationType: {
    type: String,
    required: true,
    trim: true
  },
  generatedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  expectedImpact: {
    type: String,
    required: true,
    trim: true
  },
  actualImpact: {
    type: String,
    default: "Pending Verification",
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'skipped'],
    default: 'pending'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('OptimizationImpactSnapshot', optimizationImpactSnapshotSchema);
