const asyncHandler = require('express-async-handler');
const AgentCoachingSnapshot = require('../models/AgentCoachingSnapshot');
const CoachingAction = require('../models/CoachingAction');
const { generateAgentCoaching } = require('../services/agentCoachingEngine');

/**
 * @desc    Get current AI Coaching Insights (with 15-minute smart cooldown)
 * @route   GET /api/agent-ai/coaching
 * @access  Private (Agent Only)
 */
const getAgentCoaching = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const cooldownTTL = 15 * 60 * 1000; // 15 minutes cooldown

  // Look for the latest generated snapshot
  let latestSnapshot = await AgentCoachingSnapshot.findOne({ agentId })
    .sort({ generatedAt: -1 });

  const now = Date.now();
  let servedFromCache = false;

  if (latestSnapshot) {
    const elapsed = now - new Date(latestSnapshot.generatedAt).getTime();
    if (elapsed < cooldownTTL) {
      servedFromCache = true;
    }
  }

  // Generate new snapshot if none exists or cooldown has expired
  if (!latestSnapshot || !servedFromCache) {
    latestSnapshot = await generateAgentCoaching(agentId);
  }

  // Load the agent's tracked actions for recommendations
  const actions = await CoachingAction.find({ agentId });
  const actionMap = new Map(actions.map(a => [a.recommendationId, a.status]));

  // Merge the recommendation status
  const recommendations = latestSnapshot.recommendations.map(r => ({
    id: r.id,
    text: r.text,
    status: actionMap.get(r.id) || 'pending'
  }));

  const nextRefreshAllowedAt = new Date(new Date(latestSnapshot.generatedAt).getTime() + cooldownTTL);
  const cooldownRemainingMs = Math.max(0, nextRefreshAllowedAt.getTime() - now);

  res.status(200).json({
    success: true,
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
    lastUpdated: latestSnapshot.generatedAt,
    cooldownActive: cooldownRemainingMs > 0,
    nextRefreshAllowedAt,
    cooldownRemainingMs,
    servedFromCache
  });
});

/**
 * @desc    Get Coaching History Timeline
 * @route   GET /api/agent-ai/coaching/history
 * @access  Private (Agent Only)
 */
const getCoachingHistory = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();

  // Fetch up to 10 historical coaching reports
  const snapshots = await AgentCoachingSnapshot.find({ agentId })
    .sort({ generatedAt: -1 })
    .limit(10);

  const history = snapshots.map(snap => ({
    id: snap._id,
    generatedAt: snap.generatedAt,
    productivityScore: snap.productivityScore,
    summary: snap.summary,
    mainRecommendation: snap.recommendations[0]?.text || "Focus on key task targets"
  }));

  res.status(200).json({
    success: true,
    history
  });
});

/**
 * @desc    Update Recommendation Action State
 * @route   POST /api/agent-ai/coaching/action
 * @access  Private (Agent Only)
 */
const updateRecommendationAction = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { recommendationId, status } = req.body;

  if (!recommendationId || !status) {
    res.status(400);
    throw new Error('Recommendation ID and status are required');
  }

  const validStatuses = ['completed', 'dismissed', 'saved', 'pending'];
  if (!validStatuses.includes(status)) {
    res.status(400);
    throw new Error('Invalid action status');
  }

  // Update status (upserting if a mapping doesn't exist yet)
  const action = await CoachingAction.findOneAndUpdate(
    { agentId, recommendationId },
    { status, updatedAt: Date.now() },
    { upsert: true, new: true }
  );

  res.status(200).json({
    success: true,
    action
  });
});

module.exports = {
  getAgentCoaching,
  getCoachingHistory,
  updateRecommendationAction
};
