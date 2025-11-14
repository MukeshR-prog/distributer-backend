const mongoose = require('mongoose');

const executiveSnapshotSchema = new mongoose.Schema({
  generatedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  businessHealthScore: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  slaCompliance: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  riskScore: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  automationSuccessRate: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  aiAdoptionRate: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ExecutiveSnapshot', executiveSnapshotSchema);
