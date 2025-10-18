const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reportType: {
    type: String,
    enum: ['analytics', 'leaderboard', 'performance'],
    required: [true, 'Report type is required']
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  dateRange: {
    from: {
      type: Date
    },
    to: {
      type: Date
    }
  },
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Report must belong to an admin user']
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: [true, 'Report data payload is required']
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

module.exports = mongoose.model('Report', reportSchema);
