const mongoose = require('mongoose');

const allocationPlanSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Allocation plan title is required'],
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sourceTeam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  targetTeam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  taskCount: {
    type: Number,
    required: true,
    min: [1, 'Must allocate at least 1 task']
  },
  expectedImpact: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Draft', 'Approved', 'Applied', 'Cancelled'],
    default: 'Draft'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AllocationPlan', allocationPlanSchema);
