const asyncHandler = require('express-async-handler');
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
const ActivityLog = require('../models/ActivityLog');

// Simple 5-minute memory cache
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @desc    Get Agent Productivity Analytics
 * @route   GET /api/agent-workspace/analytics
 * @access  Private (Agent Only)
 */
const getAgentAnalytics = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const now = Date.now();
  const forceRefresh = req.query.refresh === 'true';

  // Check cache validity (skip if forceRefresh is requested)
  if (!forceRefresh && cache.has(agentId)) {
    const { timestamp, data } = cache.get(agentId);
    if (now - timestamp < CACHE_TTL_MS) {
      // Audit analytics view even for cache hits
      await ActivityLog.create({
        actionType: 'AGENT_ANALYTICS_VIEWED',
        entityType: 'User',
        entityId: req.user._id,
        performedBy: req.user._id
      });

      return res.status(200).json({
        success: true,
        cached: true,
        ...data
      });
    }
  }

  // Compute all metrics concurrently for optimal performance
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

  const analyticsData = {
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

  // Cache response payload
  cache.set(agentId, {
    timestamp: now,
    data: analyticsData
  });

  // Log activity log audits
  if (forceRefresh) {
    await ActivityLog.create({
      actionType: 'PERFORMANCE_REPORT_VIEWED',
      entityType: 'User',
      entityId: req.user._id,
      performedBy: req.user._id
    });
  } else {
    await ActivityLog.create({
      actionType: 'AGENT_ANALYTICS_VIEWED',
      entityType: 'User',
      entityId: req.user._id,
      performedBy: req.user._id
    });
  }

  res.status(200).json({
    success: true,
    cached: false,
    ...analyticsData
  });
});

module.exports = {
  getAgentAnalytics
};
