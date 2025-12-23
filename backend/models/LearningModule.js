const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true
  },
  options: {
    type: [String],
    required: true,
    validate: {
      validator: function(val) {
        return val.length >= 2;
      },
      message: 'A quiz question must have at least 2 options.'
    }
  },
  correctAnswerIndex: {
    type: Number,
    required: true
  }
});

const learningModuleSchema = new mongoose.Schema({
  pathId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningPath',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: [true, 'Module title is required'],
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    required: [true, 'Module content is required']
  },
  durationMinutes: {
    type: Number,
    default: 10
  },
  order: {
    type: Number,
    default: 0
  },
  quiz: [quizSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('LearningModule', learningModuleSchema);
