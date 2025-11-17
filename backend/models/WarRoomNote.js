const mongoose = require('mongoose');

const warRoomNoteSchema = new mongoose.Schema({
  message: {
    type: String,
    required: [true, 'Note message is required'],
    trim: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Author user is required']
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  incidentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Incident',
    default: null
  }
}, {
  timestamps: { createdAt: true, updatedAt: true }
});

module.exports = mongoose.model('WarRoomNote', warRoomNoteSchema);
