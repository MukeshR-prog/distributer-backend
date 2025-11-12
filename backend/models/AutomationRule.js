const mongoose = require('mongoose');

const automationRuleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Rule name is required'],
    trim: true
  },
  triggerType: {
    type: String,
    enum: ['SLA_RISK', 'OVERDUE_TASKS', 'WORKLOAD_THRESHOLD', 'WEEKLY_REPORT', 'MONTHLY_REPORT'],
    required: [true, 'Trigger type is required']
  },
  condition: {
    field: { type: String },
    operator: { type: String }, // '>', '<', '=='
    value: { type: mongoose.Schema.Types.Mixed }
  },
  action: {
    type: { 
      type: String, 
      required: true,
      enum: ['GENERATE_AI_SUMMARY', 'CREATE_ALERT', 'GENERATE_REPORT']
    },
    params: { type: mongoose.Schema.Types.Mixed } // e.g. { reportType: 'analytics' } or { message: 'Alert text' }
  },
  isEnabled: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastRun: {
    type: Date
  },
  nextRun: {
    type: Date
  },
  status: {
    type: String,
    default: 'Active',
    enum: ['Active', 'Running', 'Paused', 'Executed', 'Error']
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AutomationRule', automationRuleSchema);
