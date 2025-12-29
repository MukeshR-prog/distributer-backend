const mongoose = require('mongoose');

const courseEnrollmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningCourse',
    required: true,
    index: true
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  status: {
    type: String,
    enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'],
    default: 'NOT_STARTED',
    index: true
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  score: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index to ensure a user can only enroll in a course once
courseEnrollmentSchema.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('CourseEnrollment', courseEnrollmentSchema);
