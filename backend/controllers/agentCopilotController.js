const asyncHandler = require('express-async-handler');
const AgentCopilotSession = require('../models/AgentCopilotSession');
const AgentCopilotPreference = require('../models/AgentCopilotPreference');
const {
  generateDailySummary,
  generateSmartPlanner,
  executeCopilotChat,
  generateAICommunicationFollowup
} = require('../services/agentCopilotEngine');

/**
 * @desc    Get Copilot Daily Summary
 * @route   GET /api/agent-copilot/summary
 * @access  Private (Agent Only)
 */
const getDailySummaryHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const io = req.app.get('io');
  
  const summary = await generateDailySummary(agentId, io);
  res.status(200).json({
    success: true,
    ...summary
  });
});

/**
 * @desc    Send Chat Prompt to AI Copilot
 * @route   POST /api/agent-copilot/chat
 * @access  Private (Agent Only)
 */
const sendChatPromptHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { message, sessionId } = req.body;
  const io = req.app.get('io');

  if (!message) {
    return res.status(400).json({ success: false, message: 'Message is required' });
  }

  const session = await executeCopilotChat(agentId, sessionId, message, io);
  res.status(200).json({
    success: true,
    session
  });
});

/**
 * @desc    Get Smart Recommendations & Planner
 * @route   GET /api/agent-copilot/recommendations
 * @access  Private (Agent Only)
 */
const getSmartPlannerHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const io = req.app.get('io');

  const planner = await generateSmartPlanner(agentId, io);
  res.status(200).json({
    success: true,
    ...planner
  });
});

/**
 * @desc    Get Conversation History Sessions
 * @route   GET /api/agent-copilot/history
 * @access  Private (Agent Only)
 */
const getSessionsHistoryHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { search } = req.query;

  const query = { agentId };
  if (search) {
    query.title = { $regex: search, $options: 'i' };
  }

  const sessions = await AgentCopilotSession.find(query)
    .sort({ isPinned: -1, updatedAt: -1 })
    .select('title isPinned updatedAt messages');

  res.status(200).json({
    success: true,
    sessions
  });
});

/**
 * @desc    Generate AI Communication Follow-up Templates
 * @route   GET /api/agent-copilot/followup/:recordId
 * @access  Private (Agent Only)
 */
const generateFollowupHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { recordId } = req.params;
  const io = req.app.get('io');

  if (!recordId) {
    return res.status(400).json({ success: false, message: 'recordId parameter is required' });
  }

  const templates = await generateAICommunicationFollowup(agentId, recordId, io);
  res.status(200).json({
    success: true,
    ...templates
  });
});

/**
 * @desc    Rename Conversation Session
 * @route   PATCH /api/agent-copilot/session/:sessionId/title
 * @access  Private (Agent Only)
 */
const renameSessionHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { sessionId } = req.params;
  const { title } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: 'Title is required' });
  }

  const session = await AgentCopilotSession.findOneAndUpdate(
    { _id: sessionId, agentId },
    { title },
    { new: true }
  );

  if (!session) {
    return res.status(404).json({ success: false, message: 'Conversation thread not found' });
  }

  res.status(200).json({
    success: true,
    session
  });
});

/**
 * @desc    Pin/Unpin Conversation Session
 * @route   POST /api/agent-copilot/session/:sessionId/pin
 * @access  Private (Agent Only)
 */
const togglePinSessionHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { sessionId } = req.params;

  const session = await AgentCopilotSession.findOne({ _id: sessionId, agentId });
  if (!session) {
    return res.status(404).json({ success: false, message: 'Conversation thread not found' });
  }

  session.isPinned = !session.isPinned;
  await session.save();

  res.status(200).json({
    success: true,
    session
  });
});

/**
 * @desc    Delete Conversation Session
 * @route   DELETE /api/agent-copilot/session/:sessionId
 * @access  Private (Agent Only)
 */
const deleteSessionHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { sessionId } = req.params;

  const session = await AgentCopilotSession.findOneAndDelete({ _id: sessionId, agentId });
  if (!session) {
    return res.status(404).json({ success: false, message: 'Conversation thread not found' });
  }

  res.status(200).json({
    success: true,
    message: 'Conversation thread deleted successfully!'
  });
});

module.exports = {
  getDailySummary: getDailySummaryHandler,
  sendChatPrompt: sendChatPromptHandler,
  getSmartPlanner: getSmartPlannerHandler,
  getSessionsHistory: getSessionsHistoryHandler,
  generateFollowup: generateFollowupHandler,
  renameSession: renameSessionHandler,
  togglePinSession: togglePinSessionHandler,
  deleteSession: deleteSessionHandler
};
