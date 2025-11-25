const mongoose = require('mongoose');

const roleTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Role name is required'],
    unique: true,
    trim: true
  },
  code: {
    type: String,
    required: [true, 'Role code is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  permissions: {
    type: [String],
    default: []
  },
  isSystem: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('RoleTemplate', roleTemplateSchema);
