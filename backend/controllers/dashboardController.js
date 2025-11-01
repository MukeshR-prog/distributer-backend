const User = require('../models/User');
const Distribution = require('../models/Distribution');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * @desc    Get dashboard overview
 * @route   GET /api/dashboard/overview
 * @access  Private
 */
const getDashboardOverview = asyncHandler(async (req, res) => {
  const userRole = req.user.role;
  
  if (userRole === 'admin') {
    // Admin dashboard
    const [agentStats, distributionStats, recentDistributions, topPerformers] = await Promise.all([
      User.getAgentStats(),
      Distribution.getDistributionStats(),
      Distribution.find()
        .populate('uploadedBy', 'name')
        .sort({ createdAt: -1 })
        .limit(5)
        .select('fileName totalRecords status createdAt'),
      User.find({ role: 'agent', assignedTasks: { $gt: 0 } })
        .sort({ completionRate: -1 })
        .limit(5)
        .select('name email assignedTasks completedTasks completionRate')
    ]);

    res.json({
      success: true,
      data: {
        stats: {
          totalAgents: agentStats.totalAgents,
          activeAgents: agentStats.activeAgents,
          totalDistributions: distributionStats.totalDistributions,
          totalRecordsProcessed: distributionStats.totalRecordsProcessed,
          totalAssignedTasks: agentStats.totalAssignedTasks,
          totalCompletedTasks: agentStats.totalCompletedTasks,
          overallCompletionRate: agentStats.totalAssignedTasks > 0 ? 
            Math.round((agentStats.totalCompletedTasks / agentStats.totalAssignedTasks) * 100) : 0
        },
        recentDistributions,
        topPerformers
      }
    });
  } else {
    // Agent dashboard
    const agent = await User.findById(req.user._id);
    
    const myDistributions = await Distribution.find({
      'agents.agentId': req.user._id
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('fileName totalRecords createdAt agents.$')
      .populate('uploadedBy', 'name');

    // Calculate agent's task summary
    const taskSummary = await Distribution.aggregate([
      { $match: { 'agents.agentId': req.user._id } },
      { $unwind: '$agents' },
      { $match: { 'agents.agentId': req.user._id } },
      { $unwind: '$agents.records' },
      {
        $group: {
          _id: '$agents.records.status',
          count: { $sum: 1 }
        }
      }
    ]);

    const taskCounts = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      failed: 0
    };

    taskSummary.forEach(item => {
      taskCounts[item._id] = item.count;
    });

    // Calculate agent's task details for SLA and Escalations
    const allAgentRecords = await Distribution.aggregate([
      { $match: { 'agents.agentId': req.user._id } },
      { $unwind: '$agents' },
      { $match: { 'agents.agentId': req.user._id } },
      { $unwind: '$agents.records' },
      {
        $project: {
          status: '$agents.records.status',
          priority: '$agents.records.priority',
          dueDate: '$agents.records.dueDate',
          slaStatus: '$agents.records.slaStatus',
          completedAt: '$agents.records.completedAt'
        }
      }
    ]);

    const { calculateSLA } = require('../utils/slaCalculator');
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const overdueCount = allAgentRecords.filter(r => {
      const currentSla = calculateSLA(r);
      return r.status !== 'completed' && r.status !== 'cancelled' && currentSla === 'overdue';
    }).length;

    const approachingDeadlineCount = allAgentRecords.filter(r => {
      const currentSla = calculateSLA(r);
      return r.status !== 'completed' && r.status !== 'cancelled' && currentSla === 'approaching_deadline';
    }).length;

    const completedToday = allAgentRecords.filter(r => {
      return r.status === 'completed' && r.completedAt && new Date(r.completedAt) >= startOfToday;
    }).length;

    const criticalTasks = allAgentRecords.filter(r => {
      return r.status !== 'completed' && r.status !== 'cancelled' && r.priority === 'critical';
    }).length;

    const completedCount = allAgentRecords.filter(r => r.status === 'completed').length;
    const averageCompletionRate = allAgentRecords.length > 0 ? Math.round((completedCount / allAgentRecords.length) * 100) : 0;

    res.json({
      success: true,
      data: {
        agent: {
          name: agent.name,
          email: agent.email,
          assignedTasks: agent.assignedTasks,
          completedTasks: agent.completedTasks,
          completionRate: agent.completionRate,
          joinedDate: agent.createdAt,
          lastLogin: agent.lastLogin
        },
        taskSummary: taskCounts,
        recentDistributions: myDistributions,
        totalAssigned: Object.values(taskCounts).reduce((sum, count) => sum + count, 0),
        slaStats: {
          overdueCount,
          approachingDeadlineCount,
          completedToday,
          criticalTasks,
          averageCompletionRate
        }
      }
    });
  }
});

/**
 * @desc    Get analytics data
 * @route   GET /api/dashboard/analytics
 * @access  Private (Admin)
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const { period = '30d' } = req.query;
  
  // Calculate date range
  const now = new Date();
  let startDate;
  
  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  // Get distribution trends
  const distributionTrends = await Distribution.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt'
          }
        },
        count: { $sum: 1 },
        totalRecords: { $sum: '$totalRecords' }
      }
    },
    { $sort: { '_id': 1 } }
  ]);

  // Get strategy performance
  const strategyPerformance = await Distribution.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: '$distributionStrategy',
        count: { $sum: 1 },
        avgRecords: { $avg: '$totalRecords' },
        avgDistributionTime: { $avg: '$summary.distributionTime' },
        totalRecords: { $sum: '$totalRecords' }
      }
    }
  ]);

  // Get agent performance trends
  const agentPerformance = await User.aggregate([
    { $match: { role: 'agent', createdAt: { $gte: startDate } } },
    {
      $project: {
        name: 1,
        assignedTasks: 1,
        completedTasks: 1,
        completionRate: {
          $cond: [
            { $eq: ['$assignedTasks', 0] },
            0,
            { $multiply: [{ $divide: ['$completedTasks', '$assignedTasks'] }, 100] }
          ]
        },
        efficiency: {
          $cond: [
            { $eq: ['$assignedTasks', 0] },
            0,
            { $divide: ['$completedTasks', '$assignedTasks'] }
          ]
        }
      }
    },
    { $sort: { completionRate: -1 } }
  ]);

  // Get task status distribution
  const taskStatusDistribution = await Distribution.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    { $unwind: '$agents' },
    { $unwind: '$agents.records' },
    {
      $group: {
        _id: '$agents.records.status',
        count: { $sum: 1 }
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      period,
      dateRange: { startDate, endDate: now },
      distributionTrends,
      strategyPerformance,
      agentPerformance,
      taskStatusDistribution
    }
  });
});

/**
 * @desc    Get recent activity
 * @route   GET /api/dashboard/activity
 * @access  Private
 */
const getRecentActivity = asyncHandler(async (req, res) => {
  const { limit = 20 } = req.query;
  
  // Recent distributions
  const recentDistributions = await Distribution.find()
    .populate('uploadedBy', 'name email')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit) / 2)
    .select('fileName totalRecords status createdAt uploadedBy');

  // Recent user activities (logins, registrations)
  const recentUsers = await User.find({ role: 'agent' })
    .sort({ lastLogin: -1 })
    .limit(parseInt(limit) / 2)
    .select('name email lastLogin createdAt');

  // Combine and format activities
  const activities = [];

  recentDistributions.forEach(dist => {
    activities.push({
      type: 'distribution',
      action: 'created',
      description: `Distribution "${dist.fileName}" created with ${dist.totalRecords} records`,
      user: dist.uploadedBy,
      timestamp: dist.createdAt,
      status: dist.status
    });
  });

  recentUsers.forEach(user => {
    if (user.lastLogin) {
      activities.push({
        type: 'user',
        action: 'login',
        description: `${user.name} logged in`,
        user: user,
        timestamp: user.lastLogin
      });
    }
  });

  // Sort by timestamp
  activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json({
    success: true,
    data: {
      activities: activities.slice(0, parseInt(limit))
    }
  });
});

/**
 * @desc    Get system health metrics
 * @route   GET /api/dashboard/health
 * @access  Private (Admin)
 */
const getSystemHealth = asyncHandler(async (req, res) => {
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Database stats
  const dbStats = await Promise.all([
    User.countDocuments(),
    Distribution.countDocuments(),
    Distribution.countDocuments({ createdAt: { $gte: last24Hours } }),
    User.countDocuments({ lastLogin: { $gte: last24Hours } })
  ]);

  // Performance metrics
  const performanceMetrics = await Distribution.aggregate([
    {
      $group: {
        _id: null,
        avgDistributionTime: { $avg: '$summary.distributionTime' },
        avgRecordsPerDistribution: { $avg: '$totalRecords' },
        totalProcessingTime: { $sum: '$summary.distributionTime' }
      }
    }
  ]);

  // Error rates (simplified - in production, you'd track actual errors)
  const errorRate = await Distribution.countDocuments({ status: 'failed' });
  const totalDistributions = await Distribution.countDocuments();

  res.json({
    success: true,
    data: {
      database: {
        totalUsers: dbStats[0],
        totalDistributions: dbStats[1],
        distributionsLast24h: dbStats[2],
        activeUsersLast24h: dbStats[3]
      },
      performance: {
        avgDistributionTime: performanceMetrics[0]?.avgDistributionTime || 0,
        avgRecordsPerDistribution: performanceMetrics[0]?.avgRecordsPerDistribution || 0,
        totalProcessingTime: performanceMetrics[0]?.totalProcessingTime || 0
      },
      reliability: {
        errorRate: totalDistributions > 0 ? (errorRate / totalDistributions) * 100 : 0,
        uptime: 99.9, // This would be calculated from actual monitoring
        successRate: totalDistributions > 0 ? ((totalDistributions - errorRate) / totalDistributions) * 100 : 100
      },
      timestamp: now
    }
  });
});

/**
 * @desc    Get personalized insights
 * @route   GET /api/dashboard/insights
 * @access  Private
 */
const getInsights = asyncHandler(async (req, res) => {
  const insights = [];

  if (req.user.role === 'admin') {
    // Admin insights
    const agentStats = await User.getAgentStats();
    const distributionStats = await Distribution.getDistributionStats();

    // Insight 1: Agent utilization
    if (agentStats.totalAgents > 0) {
      const utilizationRate = (agentStats.activeAgents / agentStats.totalAgents) * 100;
      insights.push({
        type: 'info',
        title: 'Agent Utilization',
        message: `${utilizationRate.toFixed(1)}% of agents are currently active`,
        recommendation: utilizationRate < 70 ? 'Consider activating more agents or removing inactive ones' : null
      });
    }

    // Insight 2: Distribution efficiency
    if (distributionStats.avgDistributionTime > 0) {
      insights.push({
        type: distributionStats.avgDistributionTime > 5000 ? 'warning' : 'success',
        title: 'Processing Speed',
        message: `Average distribution time: ${(distributionStats.avgDistributionTime / 1000).toFixed(2)}s`,
        recommendation: distributionStats.avgDistributionTime > 5000 ? 'Consider optimizing file processing for large files' : null
      });
    }

  } else {
    // Agent insights
    const agent = await User.findById(req.user._id);
    
    // Insight 1: Completion rate
    if (agent.assignedTasks > 0) {
      insights.push({
        type: agent.completionRate >= 80 ? 'success' : agent.completionRate >= 60 ? 'warning' : 'error',
        title: 'Performance',
        message: `Your completion rate is ${agent.completionRate}%`,
        recommendation: agent.completionRate < 80 ? 'Focus on completing pending tasks to improve your performance' : 'Great job! Keep up the excellent work'
      });
    }

    // Insight 2: Task workload
    const pendingTasks = agent.assignedTasks - agent.completedTasks;
    if (pendingTasks > 0) {
      insights.push({
        type: pendingTasks > 20 ? 'warning' : 'info',
        title: 'Workload',
        message: `You have ${pendingTasks} pending tasks`,
        recommendation: pendingTasks > 20 ? 'Consider prioritizing your pending tasks' : null
      });
    }
  }

  res.json({
    success: true,
    data: { insights }
  });
});

module.exports = {
  getDashboardOverview,
  getAnalytics,
  getRecentActivity,
  getSystemHealth,
  getInsights
};
