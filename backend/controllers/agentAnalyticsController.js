const asyncHandler = require('express-async-handler');
const {
  fetchAgentRecords,
  calculateCompletionRate,
  calculateSLACompliance,
  calculateAverageResolutionTime,
  calculateWeeklyPerformance,
  calculateMonthlyPerformance,
  calculateProductivityScore,
  calculateTeamRanking
} = require('../services/agentAnalyticsService');

// Simple 5-minute memory cache
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @desc    Get Agent Productivity Analytics and personal performance insights
 * @route   GET /api/agent-workspace/analytics
 * @access  Private (Agent)
 */
const getAgentAnalytics = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const now = Date.now();

  // Check cache validity
  if (cache.has(agentId)) {
    const { timestamp, data } = cache.get(agentId);
    if (now - timestamp < CACHE_TTL_MS) {
      return res.json({
        success: true,
        cached: true,
        ...data
      });
    }
  }

  // Pre-fetch records to reuse across calculation functions for performance
  const records = await fetchAgentRecords(agentId);

  // Compute analytics metrics
  const productivityScore = await calculateProductivityScore(agentId, records);
  const completionMetrics = await calculateCompletionRate(agentId, records);
  const slaMetrics = await calculateSLACompliance(agentId, records);
  const resolutionMetrics = await calculateAverageResolutionTime(agentId, records);
  const weeklyTrend = await calculateWeeklyPerformance(agentId, records);
  const monthlyTrend = await calculateMonthlyPerformance(agentId, records);
  const ranking = await calculateTeamRanking(agentId);

  const analyticsData = {
    productivityScore,
    completionMetrics,
    slaMetrics,
    resolutionMetrics,
    weeklyTrend,
    monthlyTrend,
    ranking
  };

  // Cache response payload
  cache.set(agentId, {
    timestamp: now,
    data: analyticsData
  });

  res.json({
    success: true,
    cached: false,
    ...analyticsData
  });
});

module.exports = {
  getAgentAnalytics
};
