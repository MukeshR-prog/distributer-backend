const mongoose = require('mongoose');

const agentCopilotPreferenceSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  preferredWorkingHours: {
    type: String,
    default: ''
  },
  preferredTaskCategories: {
    type: [String],
    default: []
  },
  commonCoachingWeaknesses: {
    type: [String],
    default: []
  },
  favoritePrompts: {
    type: [String],
    default: []
  },
  lastUsedPrompts: {
    type: [String],
    default: []
  },
  focusAreas: {
    type: [String],
    default: []
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AgentCopilotPreference', agentCopilotPreferenceSchema);
