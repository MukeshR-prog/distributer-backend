const mongoose = require('mongoose');

const workforceRecommendationSchema = new mongoose.Schema({
  recommendationType: {
    type: String,
    required: true,
    enum: ['PROMOTION', 'TRAINING', 'SUCCESSION', 'WORKLOAD_SHIFT', 'MENTORSHIP', 'RETENTION_RISK', 'LEADERSHIP', 'TALENT_MATCH']
  },
  targetType: {
    type: String,
    required: true,
    enum: ['User', 'Department', 'Team']
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'targetType'
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  priority: {
    type: String,
    required: true,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
  },
  confidenceScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  sourceSystems: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'ACCEPTED', 'DISMISSED'],
    default: 'ACTIVE',
    index: true
  },
  generatedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: { createdAt: 'generatedAt', updatedAt: 'updatedAt' }
});

workforceRecommendationSchema.index({ recommendationType: 1, status: 1 });
workforceRecommendationSchema.index({ targetId: 1, status: 1 });

module.exports = mongoose.model('WorkforceRecommendation', workforceRecommendationSchema);
