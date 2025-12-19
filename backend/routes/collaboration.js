const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const TeamChannel = require('../models/TeamChannel');
const ChannelMessage = require('../models/ChannelMessage');
const User = require('../models/User');

const router = express.Router();

// Enforce auth guards
router.use(protect);
router.use(restrictTo('agent'));

// Dynamic seeding of default channels
const seedDefaultChannelsForUser = async (user) => {
  try {
    // 1. General (Default)
    const generalChannel = await TeamChannel.findOne({ type: 'general' });
    if (!generalChannel) {
      await TeamChannel.create({
        name: 'General Channel',
        description: 'General discussion for all workspace agents.',
        type: 'general',
        isDefault: true
      });
    }

    // 2. Team Channel
    if (user.team) {
      const teamChannel = await TeamChannel.findOne({ type: 'team', team: user.team });
      if (!teamChannel) {
        await TeamChannel.create({
          name: `Team Chat (${user.team})`,
          description: `Dedicated channel for members of ${user.team}.`,
          type: 'team',
          team: user.team
        });
      }
    }

    // 3. Department Channel
    if (user.department) {
      const deptChannel = await TeamChannel.findOne({ type: 'department', department: user.department });
      if (!deptChannel) {
        await TeamChannel.create({
          name: `Dept Chat (${user.department})`,
          description: `Dedicated channel for the ${user.department} department.`,
          type: 'department',
          department: user.department
        });
      }
    }
  } catch (err) {
    console.error("⚠️ Failed to seed channels:", err.message);
  }
};

/**
 * @desc    Get all channels matching user context
 * @route   GET /api/collaboration/channels
 */
router.get('/channels', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await seedDefaultChannelsForUser(user);

    const channels = await TeamChannel.find({
      $or: [
        { type: 'general' },
        { type: 'team', team: user.team },
        { type: 'department', department: user.department }
      ]
    });

    res.status(200).json({
      success: true,
      channels
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Get messages for a channel
 * @route   GET /api/collaboration/messages/:channelId
 */
router.get('/messages/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    
    // Auto mark messages as read by this user when fetched
    await ChannelMessage.updateMany(
      { channelId, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    const messages = await ChannelMessage.find({ channelId })
      .populate('sender', 'name profileImage selectedTitle level')
      .sort({ createdAt: 1 });

    res.status(200).json({
      success: true,
      messages
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Post a new channel message
 * @route   POST /api/collaboration/messages
 */
router.post('/messages', async (req, res) => {
  try {
    const { channelId, message, attachments, mentions } = req.body;
    
    if (!channelId || (!message && (!attachments || attachments.length === 0))) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const newMessage = await ChannelMessage.create({
      channelId,
      message,
      sender: req.user._id,
      attachments: attachments || [],
      mentions: mentions || [],
      readBy: [req.user._id]
    });

    const populated = await newMessage.populate('sender', 'name profileImage selectedTitle level');
    
    // Broadcast via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`channel_${channelId}`).emit('new-message', populated);
    }

    res.status(251).json({
      success: true,
      message: populated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Update a message
 * @route   PATCH /api/collaboration/messages/:id
 */
router.patch('/messages/:id', async (req, res) => {
  try {
    const { message } = req.body;
    const msg = await ChannelMessage.findById(req.params.id);
    
    if (!msg) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    if (msg.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this message' });
    }

    msg.message = message;
    msg.editedAt = new Date();
    await msg.save();

    const populated = await msg.populate('sender', 'name profileImage selectedTitle level');

    // Broadcast via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`channel_${msg.channelId}`).emit('message-edited', populated);
    }

    res.status(200).json({
      success: true,
      message: populated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Delete a message
 * @route   DELETE /api/collaboration/messages/:id
 */
router.delete('/messages/:id', async (req, res) => {
  try {
    const msg = await ChannelMessage.findById(req.params.id);
    
    if (!msg) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    if (msg.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this message' });
    }

    const channelId = msg.channelId;
    await ChannelMessage.findByIdAndDelete(req.params.id);

    // Broadcast via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`channel_${channelId}`).emit('message-deleted', { messageId: req.params.id, channelId });
    }

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
