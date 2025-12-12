const User = require('../models/User');
const Distribution = require('../models/Distribution');
const asyncHandler = require('express-async-handler');
const { calculateSLA, getEscalationLevel } = require('../utils/slaCalculator');

/**
 * @desc    Get Agent Workspace summary data, metrics, productivity, rank, and daily plan
 * @route   GET /api/agent-workspace/workspace
 * @access  Private (Agent)
 */
const getWorkspaceData = asyncHandler(async (req, res) => {
  const agentId = req.user._id;

  // 1. Fetch agent profile info
  const user = await User.findById(agentId).select('name email role department team completionRate isActive');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'Agent profile not found'
    });
  }

  // 2. Fetch all distributions where the agent is assigned
  const distributions = await Distribution.find({
    'agents.agentId': agentId
  });

  // 3. Extract agent's records
  let agentRecords = [];
  distributions.forEach(dist => {
    const agentData = dist.agents.find(a => a.agentId.toString() === agentId.toString());
    if (agentData && agentData.records) {
      agentData.records.forEach(record => {
        const recObj = record.toObject ? record.toObject() : JSON.parse(JSON.stringify(record));
        agentRecords.push({
          ...recObj,
          distributionId: dist._id,
          distributionName: dist.fileName,
          slaStatus: calculateSLA(record),
          escalationLevel: getEscalationLevel(record)
        });
      });
    }
  });

  // Calculate metrics
  const totalTasks = agentRecords.length;
  const completedTasks = agentRecords.filter(r => r.status === 'completed').length;
  const pendingTasks = agentRecords.filter(r => r.status === 'pending').length;
  const inProgressTasks = agentRecords.filter(r => r.status === 'in-progress').length;
  const failedTasks = agentRecords.filter(r => r.status === 'failed').length;
  const criticalTasks = agentRecords.filter(r => r.status !== 'completed' && r.status !== 'cancelled' && r.priority === 'critical').length;
  
  // Overdue count (SLA status overdue and not completed/cancelled)
  const overdueTasks = agentRecords.filter(r => r.status !== 'completed' && r.status !== 'cancelled' && r.slaStatus === 'overdue').length;

  // 4. Compute daily task productivity data (completions over the last 7 days)
  const productivityHistory = [];
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dayLabel = daysOfWeek[d.getDay()];
    
    const startOfDay = new Date(d);
    const endOfDay = new Date(d);
    endOfDay.setHours(23, 59, 59, 999);
    
    const count = agentRecords.filter(r => {
      if (r.status === 'completed' && r.completedAt) {
        const completedDate = new Date(r.completedAt);
        return completedDate >= startOfDay && completedDate <= endOfDay;
      }
      return false;
    }).length;

    productivityHistory.push({
      day: dayLabel,
      completed: count,
      dateString: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    });
  }

  // 5. Calculate agent ranking dynamically among all active agents based on completion rates
  const allAgents = await User.find({ role: 'agent', isActive: true });
  const allDistributions = await Distribution.find({});
  
  const agentPerformanceList = [];
  for (const agent of allAgents) {
    let total = 0;
    let completed = 0;
    allDistributions.forEach(dist => {
      const aData = dist.agents.find(a => a.agentId.toString() === agent._id.toString());
      if (aData && aData.records) {
        total += aData.records.length;
        completed += aData.records.filter(r => r.status === 'completed').length;
      }
    });

    const completionRate = total > 0 ? (completed / total) * 100 : 0;
    agentPerformanceList.push({
      agentId: agent._id.toString(),
      name: agent.name,
      completionRate,
      completed
    });
  }

  // Sort: completionRate descending, then completed count descending
  agentPerformanceList.sort((a, b) => {
    if (b.completionRate !== a.completionRate) {
      return b.completionRate - a.completionRate;
    }
    return b.completed - a.completed;
  });

  const myRankIndex = agentPerformanceList.findIndex(a => a.agentId === agentId.toString());
  const rank = myRankIndex !== -1 ? myRankIndex + 1 : allAgents.length;

  // 6. Pull the agent's top 5 highest-priority pending tasks to serve as the "Daily Plan"
  // Prioritize active tasks: overdue first, then critical, then in-progress/pending nearest due date
  const activeTasks = agentRecords.filter(r => r.status === 'pending' || r.status === 'in-progress');
  activeTasks.sort((a, b) => {
    // 1. Overdue SLA
    const isOverdueA = a.slaStatus === 'overdue' ? 1 : 0;
    const isOverdueB = b.slaStatus === 'overdue' ? 1 : 0;
    if (isOverdueA !== isOverdueB) return isOverdueB - isOverdueA;

    // 2. Critical priority
    const isCritA = a.priority === 'critical' ? 1 : 0;
    const isCritB = b.priority === 'critical' ? 1 : 0;
    if (isCritA !== isCritB) return isCritB - isCritA;

    // 3. Priority weight
    const priorityWeights = { critical: 4, high: 3, medium: 2, low: 1 };
    const weightA = priorityWeights[a.priority?.toLowerCase()] || 0;
    const weightB = priorityWeights[b.priority?.toLowerCase()] || 0;
    if (weightA !== weightB) return weightB - weightA;

    // 4. Nearest due date
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate) - new Date(b.dueDate);
    }
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;

    return 0;
  });

  const dailyPlan = activeTasks.slice(0, 5);

  res.json({
    success: true,
    user: {
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department || "General Operations",
      team: user.team || "Default Team"
    },
    metrics: {
      totalTasks,
      completedTasks,
      pendingTasks,
      inProgressTasks,
      failedTasks,
      overdueTasks,
      criticalTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    },
    productivityHistory,
    ranking: {
      rank,
      totalAgents: allAgents.length
    },
    dailyPlan
  });
});

module.exports = {
  getWorkspaceData
};
