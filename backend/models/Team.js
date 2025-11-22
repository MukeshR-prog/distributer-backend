const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Team name is required'],
    unique: true,
    trim: true
  },
  department: {
    type: String,
    required: [true, 'Department name is required'],
    default: 'General Operations'
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  capacity: {
    type: Number,
    required: true,
    default: 15
  },
  utilizationRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 150
  },
  performanceScore: {
    type: Number,
    default: 100,
    min: 0,
    max: 100
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Team', teamSchema);
