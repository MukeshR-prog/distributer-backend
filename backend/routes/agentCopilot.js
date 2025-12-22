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
  deleteSession
} = require('../controllers/agentCopilotController');

const router = express.Router();

// Apply auth and role templates for Agent-Only access
router.use(protect);
router.use(restrictTo('agent'));

router.get('/summary', getDailySummary);
router.post('/chat', sendChatPrompt);
router.get('/recommendations', getSmartPlanner);
router.get('/history', getSessionsHistory);
router.get('/followup/:recordId', generateFollowup);

router.patch('/session/:sessionId/title', renameSession);
router.post('/session/:sessionId/pin', togglePinSession);
router.delete('/session/:sessionId', deleteSession);

module.exports = router;
