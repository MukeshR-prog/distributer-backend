const mongoose = require('mongoose');

const learningPathSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Learning path name is required'],
    unique: true,
    trim: true,
    index: true
  },
  description: {
    type: String,
    default: ''
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'easy'
  },
  estimatedHours: {
    type: Number,
    default: 1
  },
  tags: {
    type: [String],
    default: []
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('LearningPath', learningPathSchema);
