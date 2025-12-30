const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getDailySummary,
  sendChatPrompt,
  getSmartPlanner,
  getSessionsHistory,
  generateFollowup,
  renameSession,
  togglePinSession,
  deleteSession,
  getBootstrapData
} = require('../controllers/agentCopilotController');
const { requestCache, clearCacheOnMutation } = require('../services/requestCache');

const router = express.Router();

// Apply auth and role templates for Agent-Only access
router.use(protect);
router.use(restrictTo('agent'));
router.use(clearCacheOnMutation);

router.get('/bootstrap', requestCache(), getBootstrapData);
router.get('/summary', requestCache(), getDailySummary);
router.post('/chat', sendChatPrompt);
router.get('/recommendations', requestCache(), getSmartPlanner);
router.get('/history', requestCache(), getSessionsHistory);
router.get('/followup/:recordId', generateFollowup);

router.patch('/session/:sessionId/title', renameSession);
router.post('/session/:sessionId/pin', togglePinSession);
router.delete('/session/:sessionId', deleteSession);

module.exports = router;
