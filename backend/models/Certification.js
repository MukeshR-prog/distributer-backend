const mongoose = require('mongoose');

const certificationSchema = new mongoose.Schema({
  // Path certifications compatibility
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  pathId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningPath',
    index: true
  },
  title: {
    type: String,
    required: true
  },
  code: {
    type: String,
    index: true
  },
  passingScore: {
    type: Number
  },

  // Course certifications support
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningCourse',
    index: true
  },
  certificateNumber: {
    type: String,
    index: true
  },
  issuedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date
  },
  score: {
    type: Number
  }
}, {
  timestamps: { createdAt: 'issuedAt', updatedAt: false }
});

// Compound unique indexes with partialFilterExpression to allow nulls
certificationSchema.index(
  { agentId: 1, pathId: 1 }, 
  { unique: true, partialFilterExpression: { pathId: { $exists: true } } }
);

certificationSchema.index(
  { userId: 1, courseId: 1 }, 
  { unique: true, partialFilterExpression: { courseId: { $exists: true } } }
);

module.exports = mongoose.model('Certification', certificationSchema);
