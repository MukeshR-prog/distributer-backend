const mongoose = require('mongoose');

const channelMessageSchema = new mongoose.Schema({
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TeamChannel',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  attachments: {
    type: [String],
    default: []
  },
  mentions: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  ],
  reactions: [
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      emoji: {
        type: String,
        required: true
      }
    }
  ],
  editedAt: {
    type: Date
  },
  readBy: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('ChannelMessage', channelMessageSchema);
