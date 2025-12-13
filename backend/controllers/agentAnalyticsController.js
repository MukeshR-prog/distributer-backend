const asyncHandler = require('express-async-handler');
const {
  calculateCompletionMetrics,
  calculateSLAMetrics,
  calculateResolutionMetrics,
  calculateProductivityScore
} = require('../services/agentPerformanceEngine');

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

  // Check cache validity
  if (cache.has(agentId)) {
    const { timestamp, data } = cache.get(agentId);
    if (now - timestamp < CACHE_TTL_MS) {
      return res.status(200).json({
        success: true,
        cached: true,
        ...data
      });
    }
  }

  // Compute metrics concurrently for performance
  const [completionMetrics, slaMetrics, resolutionMetrics, productivity] = await Promise.all([
    calculateCompletionMetrics(agentId),
    calculateSLAMetrics(agentId),
    calculateResolutionMetrics(agentId),
    calculateProductivityScore(agentId)
  ]);

  const analyticsData = {
    productivity,
    completionMetrics,
    slaMetrics,
    resolutionMetrics
  };

  // Cache response payload
  cache.set(agentId, {
    timestamp: now,
    data: analyticsData
  });

  res.status(200).json({
    success: true,
    cached: false,
    ...analyticsData
  });
});

module.exports = {
  getAgentAnalytics
};
