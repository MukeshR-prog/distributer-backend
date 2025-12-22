const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const agentCopilotSessionSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'Conversation Thread'
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  messages: [messageSchema]
}, {
  timestamps: true
});

// Compound index for optimal sorting and querying
agentCopilotSessionSchema.index({ agentId: 1, isPinned: -1, updatedAt: -1 });

module.exports = mongoose.model('AgentCopilotSession', agentCopilotSessionSchema);
