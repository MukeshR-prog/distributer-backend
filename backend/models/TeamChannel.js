const mongoose = require('mongoose');

const teamChannelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    enum: ['general', 'team', 'department'],
    default: 'team'
  },
  team: {
    type: String,
    default: ''
  },
  department: {
    type: String,
    default: ''
  },
  isDefault: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('TeamChannel', teamChannelSchema);
