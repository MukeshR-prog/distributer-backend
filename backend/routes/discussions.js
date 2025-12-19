const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const TaskDiscussion = require('../models/TaskDiscussion');

const router = express.Router();

router.use(protect);
router.use(restrictTo('agent'));

/**
 * @desc    Get discussion thread for a task record
 * @route   GET /api/discussions/:recordId
 */
router.get('/:recordId', async (req, res) => {
  try {
    const thread = await TaskDiscussion.findOne({ recordId: req.params.recordId })
      .populate('sender', 'name profileImage selectedTitle level')
      .populate('replies.sender', 'name profileImage selectedTitle level')
      .populate('resolvedBy', 'name');

    res.status(200).json({
      success: true,
      thread
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Create a new discussion thread
 * @route   POST /api/discussions
 */
router.post('/', async (req, res) => {
  try {
    const { recordId, message, mentions } = req.body;
    
    if (!recordId || !message) {
      return res.status(400).json({ success: false, message: 'Missing recordId or message' });
    }

    let thread = await TaskDiscussion.findOne({ recordId });
    if (thread) {
      return res.status(400).json({ success: false, message: 'Discussion thread already exists for this task' });
    }

    thread = await TaskDiscussion.create({
      recordId,
      message,
      sender: req.user._id,
      mentions: mentions || []
    });

    const populated = await thread.populate('sender', 'name profileImage selectedTitle level');
    
    // Broadcast via socket.io
    const io = req.app.get('io');
    if (io) {
      io.emit('task-discussion-started', populated);
    }

    res.status(251).json({
      success: true,
      thread: populated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Add a reply to a thread
 * @route   POST /api/discussions/:id/reply
 */
router.post('/:id/reply', async (req, res) => {
  try {
    const { message, mentions } = req.body;
    const thread = await TaskDiscussion.findById(req.params.id);

    if (!thread) {
      return res.status(404).json({ success: false, message: 'Discussion thread not found' });
    }

    thread.replies.push({
      sender: req.user._id,
      message,
      mentions: mentions || []
    });

    await thread.save();

    const populated = await thread
      .populate('sender', 'name profileImage selectedTitle level')
      .populate('replies.sender', 'name profileImage selectedTitle level');

    // Broadcast update via socket
    const io = req.app.get('io');
    if (io) {
      io.emit('task-discussion-updated', populated);
    }

    res.status(200).json({
      success: true,
      thread: populated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Toggle thread resolved state
 * @route   PATCH /api/discussions/:id/resolve
 */
router.patch('/:id/resolve', async (req, res) => {
  try {
    const thread = await TaskDiscussion.findById(req.params.id);

    if (!thread) {
      return res.status(404).json({ success: false, message: 'Discussion thread not found' });
    }

    const { isResolved } = req.body;
    thread.isResolved = isResolved;
    if (isResolved) {
      thread.resolvedAt = new Date();
      thread.resolvedBy = req.user._id;
    } else {
      thread.resolvedAt = null;
      thread.resolvedBy = null;
    }

    await thread.save();

    const populated = await thread
      .populate('sender', 'name profileImage selectedTitle level')
      .populate('replies.sender', 'name profileImage selectedTitle level')
      .populate('resolvedBy', 'name');

    // Broadcast update via socket
    const io = req.app.get('io');
    if (io) {
      io.emit('task-discussion-updated', populated);
    }

    res.status(200).json({
      success: true,
      thread: populated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
