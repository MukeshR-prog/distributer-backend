const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getGamificationProfile,
  getAgentAchievements,
  getRewardsTimeline
} = require('../controllers/gamificationController');

const router = express.Router();

// Enforce authentication guards
router.use(protect);
router.use(restrictTo('agent'));

router.get('/profile', getGamificationProfile);
router.get('/achievements', getAgentAchievements);
router.get('/rewards', getRewardsTimeline);

module.exports = router;
