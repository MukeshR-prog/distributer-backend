const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getAgentCoaching,
  getCoachingHistory,
  updateRecommendationAction
} = require('../controllers/agentAICoachingController');
const { requestCache, clearCacheOnMutation } = require('../services/requestCache');

const router = express.Router();

// Apply auth and role templates for Agent-Only access
router.use(protect);
router.use(restrictTo('agent'));
router.use(clearCacheOnMutation);

router.get('/coaching', requestCache(), getAgentCoaching);
router.get('/coaching/history', requestCache(), getCoachingHistory);
router.post('/coaching/action', updateRecommendationAction);

module.exports = router;
