const { fetchAgentAnalyticsDataInternal } = require('../controllers/analyticsController');

/**
 * Generates report JSON snapshot based on parameters.
 * @param {Object} params
 * @param {String} params.from - Start date ISO string
 * @param {String} params.to - End date ISO string
 * @param {String} params.type - 'analytics' | 'leaderboard' | 'performance'
 * @returns {Promise<Object>} Formatted report JSON
 */
const generateReportData = async ({ from, to, type }) => {
  // Fetch raw analytics data reusing the existing aggregation controllers/services
  const analytics = await fetchAgentAnalyticsDataInternal(from, to);

  // Map rankings to top performers
  const topPerformers = (analytics.topPerformers || []).map((agent, index) => ({
    rank: index + 1,
    agentId: agent.agentId,
    name: agent.name,
    email: agent.email,
    assignedTasks: agent.assignedTasks || 0,
    completedTasks: agent.completedTasks || 0,
    pendingTasks: agent.pendingTasks || 0,
    inProgressTasks: agent.inProgressTasks || 0,
    failedTasks: agent.failedTasks || 0,
    completionRate: agent.completionRate || 0
  }));

  // Generate structured report JSON payload
  const reportData = {
    reportType: type,
    generatedAt: new Date().toISOString(),
    dateRange: {
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null
    },
    summaryMetrics: {
      activeAgents: analytics.activeAgents || 0,
      totalTasksCompleted: analytics.totalTasksCompleted || 0,
      averageCompletionRate: analytics.averageCompletionRate || 0,
      averageTasksPerAgent: analytics.completionMetrics?.averageTasksPerAgent || 0
    },
    statusBreakdown: {
      completed: analytics.completionMetrics?.completed || 0,
      pending: analytics.completionMetrics?.pending || 0,
      inProgress: analytics.completionMetrics?.inProgress || 0,
      failed: analytics.completionMetrics?.failed || 0,
      total: analytics.completionMetrics?.total || 0
    },
    // Tailor details field depending on type to avoid redundant layout processing but support general structure
    topPerformers: type === 'analytics' ? [] : topPerformers
  };

  return reportData;
};

module.exports = {
  generateReportData
};
