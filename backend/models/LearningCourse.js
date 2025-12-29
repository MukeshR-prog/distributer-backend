const mongoose = require('mongoose');

const learningCourseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Course title is required'],
    unique: true,
    trim: true,
    index: true
  },
  description: {
    type: String,
    required: [true, 'Course description is required']
  },
  category: {
    type: String,
    required: [true, 'Course category is required'],
    enum: ['Operations', 'Leadership', 'Communication', 'Customer Service', 'Analytics', 'Management', 'Technical'],
    index: true
  },
  difficulty: {
    type: String,
    required: [true, 'Course difficulty is required'],
    enum: ['Beginner', 'Intermediate', 'Advanced'],
    default: 'Beginner'
  },
  durationHours: {
    type: Number,
    required: [true, 'Course duration in hours is required'],
    default: 1
  },
  skills: {
    type: [String],
    default: []
  },
  prerequisites: {
    type: [String],
    default: []
  },
  certificationEnabled: {
    type: Boolean,
    default: false
  },
  pointsReward: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('LearningCourse', learningCourseSchema);
