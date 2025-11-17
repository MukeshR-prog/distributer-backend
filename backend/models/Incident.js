const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Incident title is required'],
    trim: true
  },
  incidentType: {
    type: String,
    enum: [
      'SLA Incident',
      'Automation Incident',
      'AI Service Incident',
      'Workload Incident',
      'Performance Incident'
    ],
    required: [true, 'Incident type is required']
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['open', 'acknowledged', 'resolved'],
    default: 'open'
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  sourceAlertId: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Incident', incidentSchema);
