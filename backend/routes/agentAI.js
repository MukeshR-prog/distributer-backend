const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getAgentCoaching,
  getCoachingHistory,
  updateRecommendationAction
} = require('../controllers/agentAICoachingController');

const router = express.Router();

// Apply auth and role templates for Agent-Only access
router.use(protect);
router.use(restrictTo('agent'));

router.get('/coaching', getAgentCoaching);
router.get('/coaching/history', getCoachingHistory);
router.post('/coaching/action', updateRecommendationAction);

module.exports = router;
