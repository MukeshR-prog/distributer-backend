const Distribution = require('../models/Distribution');
const User = require('../models/User');
const PerformanceSnapshot = require('../models/PerformanceSnapshot');
const RiskSnapshot = require('../models/RiskSnapshot');
const { asyncHandler } = require('../middleware/errorHandler');
const { calculateAgentPerformanceAsOf, backfillSnapshots } = require('../utils/performanceCalculator');
const { calculateAgentRiskAsOf, backfillRiskSnapshots } = require('../utils/riskCalculator');

/**
 * @desc    Helper to aggregate and fetch agent analytics data (reusable by reports)
 */
const fetchAgentAnalyticsDataInternal = async (from, to) => {
  // Build match filters based on date range parameters
  const matchStage = {};
  if (from || to) {
    matchStage.createdAt = {};
    if (from) {
      matchStage.createdAt.$gte = new Date(from);
    }
    if (to) {
      const end = new Date(to);
      if (to.length <= 10) {
        end.setHours(23, 59, 59, 999);
      }
      matchStage.createdAt.$lte = end;
    }
  }

  // Retrieve count of registered active agents
  const activeAgents = await User.countDocuments({ role: 'agent', isActive: true });

  // MongoDB Aggregation Pipeline to compute individual agent performance
  const topPerformersPipeline = [
    ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
    { $unwind: '$agents' },
    { $unwind: '$agents.records' },
    {
      $group: {
        _id: '$agents.agentId',
        name: { $first: '$agents.agentName' },
        email: { $first: '$agents.agentEmail' },
        assignedTasks: { $sum: 1 },
        completedTasks: {
          $sum: { $cond: [{ $eq: ['$agents.records.status', 'completed'] }, 1, 0] }
        },
        pendingTasks: {
          $sum: { $cond: [{ $eq: ['$agents.records.status', 'pending'] }, 1, 0] }
        },
        inProgressTasks: {
          $sum: { $cond: [{ $eq: ['$agents.records.status', 'in-progress'] }, 1, 0] }
        },
        failedTasks: {
          $sum: { $cond: [{ $eq: ['$agents.records.status', 'failed'] }, 1, 0] }
        }
      }
    },
    {
      $project: {
        agentId: '$_id',
        name: 1,
        email: 1,
        assignedTasks: 1,
        completedTasks: 1,
        pendingTasks: 1,
        inProgressTasks: 1,
        failedTasks: 1,
        completionRate: {
          $cond: [
            { $eq: ['$assignedTasks', 0] },
            0,
            { $round: [{ $multiply: [{ $divide: ['$completedTasks', '$assignedTasks'] }, 100] }, 1] }
          ]
        }
      }
    },
    { $sort: { completionRate: -1, completedTasks: -1 } }
  ];

  const topPerformers = await Distribution.aggregate(topPerformersPipeline);

  // Compute overall summary metrics from the aggregated results
  let totalTasksCompleted = 0;
  let totalTasksPending = 0;
  let totalTasksInProgress = 0;
  let totalTasksFailed = 0;
  let totalTasksAssigned = 0;

  topPerformers.forEach((agent) => {
    totalTasksCompleted += agent.completedTasks;
    totalTasksPending += agent.pendingTasks;
    totalTasksInProgress += agent.inProgressTasks;
    totalTasksFailed += agent.failedTasks;
    totalTasksAssigned += agent.assignedTasks;
  });

  const averageCompletionRate = totalTasksAssigned > 0
    ? Math.round((totalTasksCompleted / totalTasksAssigned) * 1000) / 10
    : 0;

  const averageTasksPerAgent = topPerformers.length > 0
    ? Math.round(totalTasksAssigned / topPerformers.length)
    : 0;

  const completionMetrics = {
    completed: totalTasksCompleted,
    pending: totalTasksPending,
    inProgress: totalTasksInProgress,
    failed: totalTasksFailed,
    total: totalTasksAssigned,
    averageTasksPerAgent
  };

  return {
    topPerformers,
    completionMetrics,
    averageCompletionRate,
    activeAgents,
    totalTasksCompleted
  };
};

/**
 * @desc    Get agent performance analytics and reporting metrics
 * @route   GET /api/analytics/agents
 * @access  Private (Admin)
 */
const getAgentAnalytics = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const analyticsData = await fetchAgentAnalyticsDataInternal(from, to);
  res.status(200).json({
    success: true,
    ...analyticsData
  });
});

const getWorkloadAnalytics = asyncHandler(async (req, res) => {
  const { calculateAgentWorkload } = require('../utils/workloadCalculator');
  
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});
  
  const agentMetrics = calculateAgentWorkload(distributions, agents);
  
  const overloadedAgents = agentMetrics.filter(a => a.status === 'Overloaded');
  const healthyAgents = agentMetrics.filter(a => a.status === 'Healthy');
  
  res.status(200).json({
    success: true,
    agentMetrics,
    overloadedAgents,
    healthyAgents
  });
});

/**
 * @desc    Get detailed agent performance scorecard metrics and historical snapshots
 * @route   GET /api/analytics/performance
 * @access  Private (Admin)
 */
const getPerformanceAnalytics = asyncHandler(async (req, res) => {
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});

  // Trigger snapshot backfill for all active agents
  await backfillSnapshots(distributions, agents);

  const agentDetails = [];
  let totalScore = 0;
  let scoredAgentsCount = 0;

  const scoreDistribution = {
    'A+': 0,
    'A': 0,
    'B': 0,
    'C': 0,
    'D': 0
  };

  for (const agent of agents) {
    const currentMetrics = calculateAgentPerformanceAsOf(agent._id, distributions, new Date());
    
    // Retrieve historical weekly snapshots sorted chronologically
    const history = await PerformanceSnapshot.find({ agentId: agent._id })
      .sort({ weekStartDate: 1 });

    agentDetails.push({
      agentId: agent._id,
      name: agent.name,
      email: agent.email,
      metrics: currentMetrics,
      history: history.map(h => ({
        weekStartDate: h.weekStartDate,
        metrics: h.metrics
      }))
    });

    if (currentMetrics.totalAssigned > 0) {
      totalScore += currentMetrics.performanceScore;
      scoredAgentsCount++;
    }

    scoreDistribution[currentMetrics.grade] = (scoreDistribution[currentMetrics.grade] || 0) + 1;
  }

  const teamAverageScore = scoredAgentsCount > 0 ? Math.round((totalScore / scoredAgentsCount) * 10) / 10 : 0;

  // Filter top performers (Score >= 80) and sort descending
  const topPerformers = agentDetails
    .filter(a => a.metrics.performanceScore >= 80)
    .sort((a, b) => b.metrics.performanceScore - a.metrics.performanceScore);

  // Filter improvement needed (Score < 70) and sort ascending
  const improvementNeeded = agentDetails
    .filter(a => a.metrics.performanceScore < 70)
    .sort((a, b) => a.metrics.performanceScore - b.metrics.performanceScore);

  res.status(200).json({
    success: true,
    topPerformers,
    improvementNeeded,
    teamAverageScore,
    scoreDistribution,
    agents: agentDetails
  });
});

/**
 * @desc    Get detailed predictive SLA risk metrics and historical daily snapshots
 * @route   GET /api/analytics/risk
 * @access  Private (Admin)
 */
const getRiskAnalytics = asyncHandler(async (req, res) => {
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});

  // Backfill daily snapshots for the past 7 days
  await backfillRiskSnapshots(distributions, agents);

  const agentDetails = [];
  let totalScoreSum = 0;
  let agentsWithActiveTasksCount = 0;
  let criticalRisksCount = 0;
  let upcomingSLABreaches = 0;

  const scoreDistribution = {
    'Low Risk': 0,
    'Medium Risk': 0,
    'High Risk': 0,
    'Critical Risk': 0
  };

  for (const agent of agents) {
    const currentRisk = calculateAgentRiskAsOf(agent._id, distributions, new Date());
    
    // Retrieve historical daily snapshots sorted chronologically
    const history = await RiskSnapshot.find({ agentId: agent._id })
      .sort({ date: 1 });

    agentDetails.push({
      agentId: agent._id,
      name: agent.name,
      email: agent.email,
      metrics: currentRisk,
      history: history.map(h => ({
        date: h.date,
        riskScore: h.riskScore,
        workload: h.workload,
        slaMetrics: h.slaMetrics
      }))
    });

    if (currentRisk.activeTasks > 0) {
      totalScoreSum += currentRisk.riskScore;
      agentsWithActiveTasksCount++;
    }

    if (currentRisk.riskCategory === 'Critical Risk') {
      criticalRisksCount++;
    }

    upcomingSLABreaches += currentRisk.approachingTasks;
    scoreDistribution[currentRisk.riskCategory] = (scoreDistribution[currentRisk.riskCategory] || 0) + 1;
  }

  const teamAverageRisk = agentsWithActiveTasksCount > 0 ? Math.round((totalScoreSum / agentsWithActiveTasksCount) * 10) / 10 : 0;

  res.status(200).json({
    success: true,
    globalMetrics: {
      totalRisk: teamAverageRisk,
      criticalRisksCount,
      upcomingSLABreaches
    },
    scoreDistribution,
    agents: agentDetails
  });
});

module.exports = {
  getAgentAnalytics,
  fetchAgentAnalyticsDataInternal,
  getWorkloadAnalytics,
  getPerformanceAnalytics,
  getRiskAnalytics
};
