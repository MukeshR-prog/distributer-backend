const express = require('express');
const { getAIInsights, getAICoaching, getAIExecutiveSummary } = require('../controllers/aiController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Apply auth protection & admin restriction to all AI endpoints
router.use(protect);
router.use(restrictTo('admin'));

router.get('/insights', getAIInsights);
router.get('/coaching/:agentId', getAICoaching);
router.get('/executive-summary', getAIExecutiveSummary);

module.exports = router;
