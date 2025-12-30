const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const Announcement = require('../models/Announcement');
const User = require('../models/User');

const router = express.Router();

router.use(protect);
router.use(restrictTo('agent', 'admin', 'executive'));

/**
 * @desc    Get active announcements matching user scope
 * @route   GET /api/announcements
 */
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const now = new Date();

    const announcements = await Announcement.find({
      $and: [
        {
          $or: [
            { scope: 'global' },
            { scope: 'team', team: user.team },
            { scope: 'department', department: user.department }
          ]
        },
        {
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gt: now } }
          ]
        }
      ]
    })
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      announcements
    });
  } catch (err) {
    console.error("Announcements error:", err.message);
    res.status(200).json({
      success: true,
      announcements: []
    });
  }
});

/**
 * @desc    Create a new announcement
 * @route   POST /api/announcements
 */
router.post('/', async (req, res) => {
  try {
    const { title, content, priority, scope, team, department, expiresAt } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Title and content are required' });
    }

    const announcement = await Announcement.create({
      title,
      content,
      priority: priority || 'medium',
      scope: scope || 'global',
      team: team || '',
      department: department || '',
      expiresAt: expiresAt || null,
      createdBy: req.user._id
    });

    const populated = await announcement.populate('createdBy', 'name');

    // Broadcast live update
    const io = req.app.get('io');
    if (io) {
      io.emit('new-announcement', populated);
    }

    res.status(201).json({
      success: true,
      announcement: populated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Mark announcement as read
 * @route   POST /api/announcements/:id/read
 */
router.post('/:id/read', async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }

    // Add user ID to readBy array if not already present
    if (!announcement.readBy.includes(req.user._id)) {
      announcement.readBy.push(req.user._id);
      await announcement.save();
    }

    // Broadcast live read status update
    const io = req.app.get('io');
    if (io) {
      io.emit('announcement-read', {
        announcementId: announcement._id,
        userId: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      announcement
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
