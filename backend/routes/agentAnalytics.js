const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const { getAgentAnalytics } = require('../controllers/agentAnalyticsController');

const router = express.Router();

// Apply auth and agent checks for all routes
router.use(protect);
router.use(restrictTo('agent'));

router.get('/analytics', getAgentAnalytics);

module.exports = router;
