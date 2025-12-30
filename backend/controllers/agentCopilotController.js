const asyncHandler = require('express-async-handler');
const AgentCopilotSession = require('../models/AgentCopilotSession');
const AgentCopilotPreference = require('../models/AgentCopilotPreference');
const User = require('../models/User');
const AgentCoachingSnapshot = require('../models/AgentCoachingSnapshot');
const CoachingAction = require('../models/CoachingAction');
const {
  generateDailySummary,
  generateSmartPlanner,
  executeCopilotChat,
  generateAICommunicationFollowup
} = require('../services/agentCopilotEngine');
const { generateAgentCoaching } = require('../services/agentCoachingEngine');
const { evaluateAchievements } = require('../services/achievementEngine');
const {
  calculateCompletionMetrics,
  calculateSLAMetrics,
  calculateResolutionMetrics,
  calculateProductivityScore,
  calculateAgentRanking,
  calculateWeeklyTrend,
  calculateMonthlyTrend,
  calculateImprovementMetrics,
  calculatePersonalBests
} = require('../services/agentPerformanceEngine');

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

/**
 * @desc    Get dashboard bootstrap data (copilot, performance, gamification, coaching)
 * @route   GET /api/agent-copilot/bootstrap
 * @access  Private (Agent Only)
 */
const getBootstrapData = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const io = req.app.get('io');

  // Fetch summary and planner concurrently
  const [summary, planner] = await Promise.all([
    generateDailySummary(agentId, io).catch(err => {
      console.error("Bootstrap summary error:", err.message);
      return { dailyTarget: 0, completedTasks: 0, pendingTasks: 0, performanceIndex: 0, recommendations: [], focusAreas: [] };
    }),
    generateSmartPlanner(agentId, io).catch(err => {
      console.error("Bootstrap planner error:", err.message);
      return { tasks: [], calendarEvents: [], coachingInsights: [], marketplaceOpportunities: [] };
    })
  ]);

  // Fetch analytics data
  let analytics = null;
  try {
    const [
      completionMetrics,
      slaMetrics,
      resolutionMetrics,
      productivity,
      ranking,
      weeklyTrend,
      monthlyTrend,
      improvement,
      personalBests
    ] = await Promise.all([
      calculateCompletionMetrics(agentId),
      calculateSLAMetrics(agentId),
      calculateResolutionMetrics(agentId),
      calculateProductivityScore(agentId),
      calculateAgentRanking(agentId),
      calculateWeeklyTrend(agentId),
      calculateMonthlyTrend(agentId),
      calculateImprovementMetrics(agentId),
      calculatePersonalBests(agentId)
    ]);
    analytics = {
      productivity,
      completionMetrics,
      slaMetrics,
      resolutionMetrics,
      ranking,
      weeklyTrend,
      monthlyTrend,
      improvement,
      personalBests
    };
  } catch (err) {
    console.error("Bootstrap analytics error:", err.message);
    analytics = {
      productivity: { productivityScore: 0, scoreChange: 0 },
      completionMetrics: { completed: 0, total: 0, rate: 0 },
      slaMetrics: { complianceRate: 0, breaches: 0 },
      resolutionMetrics: { averageTime: 0 },
      ranking: { rank: 0, totalAgents: 0 },
      weeklyTrend: [],
      monthlyTrend: [],
      improvement: { growthRate: 0 },
      personalBests: []
    };
  }

  // Fetch coaching data
  let coaching = null;
  try {
    let latestSnapshot = await AgentCoachingSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });
    const now = Date.now();
    const cooldownTTL = 15 * 60 * 1000;
    let servedFromCache = false;
    if (latestSnapshot) {
      const elapsed = now - new Date(latestSnapshot.generatedAt).getTime();
      if (elapsed < cooldownTTL) {
        servedFromCache = true;
      }
    }
    if (!latestSnapshot || !servedFromCache) {
      latestSnapshot = await generateAgentCoaching(agentId);
    }
    const actions = await CoachingAction.find({ agentId });
    const actionMap = new Map(actions.map(a => [a.recommendationId, a.status]));
    const recommendations = latestSnapshot.recommendations.map(r => ({
      id: r.id,
      text: r.text,
      status: actionMap.get(r.id) || 'pending'
    }));
    coaching = {
      _id: latestSnapshot._id,
      summary: latestSnapshot.summary,
      strengths: latestSnapshot.strengths,
      weaknesses: latestSnapshot.weaknesses,
      recommendations,
      goals: latestSnapshot.goals,
      confidence: latestSnapshot.confidence,
      focusArea: latestSnapshot.focusArea,
      motivationMessage: latestSnapshot.motivationMessage,
      source: latestSnapshot.source,
      lastUpdated: latestSnapshot.generatedAt
    };
  } catch (err) {
    console.error("Bootstrap coaching error:", err.message);
    coaching = {
      summary: "No coaching profile available yet",
      strengths: [],
      weaknesses: [],
      recommendations: [],
      goals: [],
      confidence: 0,
      focusArea: "General",
      motivationMessage: "Keep up the work!"
    };
  }

  // Fetch gamification profile
  let gamification = null;
  try {
    await evaluateAchievements(agentId, io);
    const user = await User.findById(agentId);
    const getLevelTierName = (level) => {
      if (level >= 20) return "Diamond Tier";
      if (level >= 15) return "Platinum Tier";
      if (level >= 10) return "Gold Tier";
      if (level >= 5) return "Silver Tier";
      return "Bronze Tier";
    };
    const tierName = getLevelTierName(user.level || 1);
    const currentXPInLevel = (user.xp || 0) % 1000;
    const xpProgressPercent = Math.round((currentXPInLevel / 1000) * 100);
    gamification = {
      points: user.points || 0,
      xp: user.xp || 0,
      level: user.level || 1,
      levelName: tierName,
      currentStreak: user.currentStreak || 0,
      longestStreak: user.longestStreak || 0,
      currentXPInLevel,
      xpProgressPercent,
      xpNextLevel: 1000,
      selectedTitle: user.selectedTitle || '',
      selectedTheme: user.selectedTheme || ''
    };
  } catch (err) {
    console.error("Bootstrap gamification error:", err.message);
    gamification = {
      points: 0,
      xp: 0,
      level: 1,
      levelName: "Bronze Tier",
      currentStreak: 0,
      longestStreak: 0,
      currentXPInLevel: 0,
      xpProgressPercent: 0,
      xpNextLevel: 1000,
      selectedTitle: '',
      selectedTheme: ''
    };
  }

  res.status(200).json({
    success: true,
    summary,
    planner,
    analytics,
    coaching,
    gamification
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
  deleteSession: deleteSessionHandler,
  getBootstrapData
};
