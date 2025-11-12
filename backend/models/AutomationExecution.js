const mongoose = require('mongoose');

const automationExecutionSchema = new mongoose.Schema({
  ruleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AutomationRule',
    required: false // Optional, can be null for test simulation runs
  },
  executedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  executionStatus: {
    type: String,
    enum: ['Success', 'Failure'],
    required: true
  },
  executionDuration: {
    type: Number, // Execution runtime in milliseconds
    required: true
  },
  actionType: {
    type: String,
    required: true
  },
  executionResult: {
    type: mongoose.Schema.Types.Mixed
  },
  errorMessage: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AutomationExecution', automationExecutionSchema);
