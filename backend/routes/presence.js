const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

router.use(protect);
router.use(restrictTo('agent'));

/**
 * @desc    Get presence status roster for all agents
 * @route   GET /api/presence
 */
router.get('/', async (req, res) => {
  try {
    const roster = await User.find({ role: 'agent', isActive: true })
      .select('name email profileImage presenceStatus lastSeen activeWorkspace selectedTitle level team department');

    res.status(200).json({
      success: true,
      roster
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Update current user status or active workspace location
 * @route   POST /api/presence/status
 */
router.post('/status', async (req, res) => {
  try {
    const { status, activeWorkspace } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (status) {
      user.presenceStatus = status;
    }
    if (activeWorkspace !== undefined) {
      user.activeWorkspace = activeWorkspace;
    }
    user.lastSeen = new Date();

    await user.save({ validateBeforeSave: false });

    // Emit live presence broadcast
    const io = req.app.get('io');
    if (io) {
      io.emit('presence-update', {
        userId: user._id,
        name: user.name,
        presenceStatus: user.presenceStatus,
        lastSeen: user.lastSeen,
        activeWorkspace: user.activeWorkspace
      });
    }

    res.status(200).json({
      success: true,
      presence: {
        presenceStatus: user.presenceStatus,
        lastSeen: user.lastSeen,
        activeWorkspace: user.activeWorkspace
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
