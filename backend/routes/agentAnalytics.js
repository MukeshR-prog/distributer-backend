const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const { getAgentAnalytics } = require('../controllers/agentAnalyticsController');
const { requestCache, clearCacheOnMutation } = require('../services/requestCache');

const router = express.Router();

// Apply auth and agent checks for all routes
router.use(protect);
router.use(restrictTo('agent'));
router.use(clearCacheOnMutation);

router.get('/analytics', requestCache(), getAgentAnalytics);

module.exports = router;
