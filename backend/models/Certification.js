const mongoose = require('mongoose');

const certificationSchema = new mongoose.Schema({
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
  title: {
    type: String,
    required: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  issuedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  passingScore: {
    type: Number,
    required: true
  }
}, {
  timestamps: { createdAt: 'issuedAt', updatedAt: false }
});

certificationSchema.index({ agentId: 1, pathId: 1 }, { unique: true });

module.exports = mongoose.model('Certification', certificationSchema);
