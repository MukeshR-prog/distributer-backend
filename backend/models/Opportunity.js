const mongoose = require('mongoose');

const opportunitySchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Opportunity title is required'],
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Opportunity description is required']
  },
  category: {
    type: String,
    enum: {
      values: ['PROJECT', 'MENTORSHIP', 'LEADERSHIP', 'SPECIAL_ASSIGNMENT', 'CERTIFICATION'],
      message: 'Category must be PROJECT, MENTORSHIP, LEADERSHIP, SPECIAL_ASSIGNMENT, or CERTIFICATION'
    },
    required: [true, 'Opportunity category is required']
  },
  requiredSkills: {
    type: [String],
    required: [true, 'Required skills are required'],
    default: []
  },
  minimumReadinessScore: {
    type: Number,
    required: [true, 'Minimum readiness score is required'],
    min: [0, 'Readiness score cannot be less than 0'],
    max: [100, 'Readiness score cannot exceed 100']
  },
  rewardPoints: {
    type: Number,
    default: 100
  },
  status: {
    type: String,
    enum: ['active', 'closed'],
    default: 'active',
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator User ID is required']
  },
  expiresAt: {
    type: Date,
    required: [true, 'Expiration date is required'],
    index: true
  }
}, {
  timestamps: true
});

// Indexes for performance optimization
opportunitySchema.index({ category: 1 });
opportunitySchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('Opportunity', opportunitySchema);
