const User = require('../models/User');
const Distribution = require('../models/Distribution');
const ActivityLog = require('../models/ActivityLog');

/**
 * Helper to fetch all records assigned to a specific agent
 */
const fetchAgentRecords = async (agentId) => {
  const distributions = await Distribution.find({
    'agents.agentId': agentId
  });

  const records = [];
  distributions.forEach(dist => {
    const agentData = dist.agents.find(a => a.agentId.toString() === agentId.toString());
    if (agentData && agentData.records) {
      agentData.records.forEach(r => {
        records.push({
          ...r.toObject ? r.toObject() : JSON.parse(JSON.stringify(r)),
          distributionId: dist._id,
          distributionName: dist.fileName
        });
      });
    }
  });
  return records;
};

/**
 * 1. Calculate Completion Rate
 */
const calculateCompletionRate = async (agentId, preFetchedRecords = null) => {
  const records = preFetchedRecords || await fetchAgentRecords(agentId);
  const totalAssigned = records.length;
  const totalCompleted = records.filter(r => r.status === 'completed').length;
  const completionRate = totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0;

  return {
    totalAssigned,
    totalCompleted,
    completionRate
  };
};

/**
 * 2. Calculate SLA Compliance
 */
const calculateSLACompliance = async (agentId, preFetchedRecords = null) => {
  const records = preFetchedRecords || await fetchAgentRecords(agentId);
  const completedTasks = records.filter(r => r.status === 'completed');

  let onTimeCompleted = 0;
  let lateCompleted = 0;

  completedTasks.forEach(r => {
    if (!r.dueDate) {
      onTimeCompleted++;
    } else {
      const completedTime = new Date(r.completedAt || r.updatedAt).getTime();
      const dueTime = new Date(r.dueDate).getTime();
      if (completedTime <= dueTime) {
        onTimeCompleted++;
      } else {
        lateCompleted++;
      }
    }
  });

  const totalCompleted = completedTasks.length;
  const slaCompliance = totalCompleted > 0 ? Math.round((onTimeCompleted / totalCompleted) * 100) : 100;

  return {
    onTimeCompleted,
    lateCompleted,
    slaCompliance
  };
};

/**
 * 3. Calculate Average Resolution Time
 */
const calculateAverageResolutionTime = async (agentId, preFetchedRecords = null) => {
  const records = preFetchedRecords || await fetchAgentRecords(agentId);
  const completedTasks = records.filter(r => r.status === 'completed' && r.assignedAt && (r.completedAt || r.updatedAt));

  if (completedTasks.length === 0) {
    return {
      avgResolutionTime: 0,
      fastestResolution: 0,
      slowestResolution: 0
    };
  }

  let totalHours = 0;
  let fastest = Infinity;
  let slowest = -Infinity;

  completedTasks.forEach(r => {
    const assignedTime = new Date(r.assignedAt).getTime();
    const completedTime = new Date(r.completedAt || r.updatedAt).getTime();
    const diffHours = (completedTime - assignedTime) / (1000 * 60 * 60);

    totalHours += diffHours;
    if (diffHours < fastest) fastest = diffHours;
    if (diffHours > slowest) slowest = diffHours;
  });

  return {
    avgResolutionTime: Math.round((totalHours / completedTasks.length) * 10) / 10,
    fastestResolution: fastest === Infinity ? 0 : Math.round(fastest * 10) / 10,
    slowestResolution: slowest === -Infinity ? 0 : Math.round(slowest * 10) / 10
  };
};

/**
 * 4. Calculate Weekly Performance (Last 7 Days)
 */
const calculateWeeklyPerformance = async (agentId, preFetchedRecords = null) => {
  const records = preFetchedRecords || await fetchAgentRecords(agentId);
  const weeklyData = [];
  const today = new Date();
  
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dayLabel = daysOfWeek[d.getDay()];

    const startOfDay = new Date(d);
    const endOfDay = new Date(d);
    endOfDay.setHours(23, 59, 59, 999);

    const completed = records.filter(r => {
      if (r.status === 'completed' && r.completedAt) {
        const compDate = new Date(r.completedAt);
        return compDate >= startOfDay && compDate <= endOfDay;
      }
      return false;
    }).length;

    // Count pending/in-progress tasks as of that day (tasks created before end of that day and not completed before start of that day)
    const pending = records.filter(r => {
      const assignedDate = new Date(r.assignedAt || r.createdAt);
      if (assignedDate > endOfDay) return false;
      
      if (r.status === 'completed' && r.completedAt) {
        const compDate = new Date(r.completedAt);
        return compDate > endOfDay;
      }
      if (r.status === 'failed' || r.status === 'cancelled') {
        const updDate = new Date(r.updatedAt || r.completedAt);
        return updDate > endOfDay;
      }
      return true;
    }).length;

    weeklyData.push({
      date: dayLabel,
      completed,
      pending
    });
  }

  return weeklyData;
};

/**
 * 5. Calculate Monthly Performance (Last 30 Days grouped into 4 weeks)
 */
const calculateMonthlyPerformance = async (agentId, preFetchedRecords = null) => {
  const records = preFetchedRecords || await fetchAgentRecords(agentId);
  const monthlyData = [];
  const today = new Date();

  // Create 4 weekly buckets
  for (let w = 3; w >= 0; w--) {
    const startOffset = (w + 1) * 7;
    const endOffset = w * 7;

    const startDate = new Date();
    startDate.setDate(today.getDate() - startOffset);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date();
    endDate.setDate(today.getDate() - endOffset);
    endDate.setHours(23, 59, 59, 999);

    // Get tasks that were active or completed during this week bucket
    const weeklyTasks = records.filter(r => {
      const assignedDate = new Date(r.assignedAt || r.createdAt);
      return assignedDate <= endDate;
    });

    const completedInWeek = weeklyTasks.filter(r => {
      if (r.status === 'completed' && r.completedAt) {
        const compDate = new Date(r.completedAt);
        return compDate >= startDate && compDate <= endDate;
      }
      return false;
    }).length;

    const weeklyRate = weeklyTasks.length > 0 ? Math.round((completedInWeek / weeklyTasks.length) * 100) : 0;

    monthlyData.push({
      week: `Week ${4 - w}`,
      completionRate: weeklyRate
    });
  }

  return monthlyData;
};

/**
 * 6. Calculate Productivity Score
 */
const calculateProductivityScore = async (agentId, preFetchedRecords = null) => {
  const records = preFetchedRecords || await fetchAgentRecords(agentId);

  // Completion Rate (40%)
  const { completionRate } = await calculateCompletionRate(agentId, records);

  // SLA Compliance (35%)
  const { slaCompliance } = await calculateSLACompliance(agentId, records);

  // Activity Participation (15%)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const activityCount = await ActivityLog.countDocuments({
    userId: agentId,
    createdAt: { $gte: thirtyDaysAgo }
  });
  // Benchmarked: 30 activities in 30 days = 100% participation
  const activityParticipation = Math.min(Math.round((activityCount / 30) * 100), 100);

  // Resolution Speed Score (10%)
  const { avgResolutionTime } = await calculateAverageResolutionTime(agentId, records);
  let resolutionSpeedScore = 0;
  if (avgResolutionTime > 0) {
    if (avgResolutionTime <= 2) resolutionSpeedScore = 100;
    else if (avgResolutionTime <= 6) resolutionSpeedScore = 90;
    else if (avgResolutionTime <= 12) resolutionSpeedScore = 80;
    else if (avgResolutionTime <= 24) resolutionSpeedScore = 70;
    else if (avgResolutionTime <= 48) resolutionSpeedScore = 50;
    else resolutionSpeedScore = 30;
  } else {
    resolutionSpeedScore = 100; // Optimal if no tasks were late or processed
  }

  // Aggregate Productivity Score
  const score = Math.round(
    (completionRate * 0.40) +
    (slaCompliance * 0.35) +
    (activityParticipation * 0.15) +
    (resolutionSpeedScore * 0.10)
  );

  let grade = 'D';
  if (score >= 95) grade = 'A+';
  else if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';

  return {
    score,
    grade,
    breakdown: {
      completionRate,
      slaCompliance,
      activityParticipation,
      resolutionSpeedScore
    }
  };
};

/**
 * 7. Calculate Team Ranking
 */
const calculateTeamRanking = async (agentId) => {
  const activeAgents = await User.find({ role: 'agent', isActive: true });
  const allDistributions = await Distribution.find({});

  const agentScoreList = [];
  for (const agent of activeAgents) {
    // Collect records
    let total = 0;
    let completed = 0;
    let onTime = 0;

    allDistributions.forEach(dist => {
      const aData = dist.agents.find(a => a.agentId.toString() === agent._id.toString());
      if (aData && aData.records) {
        total += aData.records.length;
        aData.records.forEach(r => {
          if (r.status === 'completed') {
            completed++;
            if (!r.dueDate) {
              onTime++;
            } else {
              const compTime = new Date(r.completedAt || r.updatedAt).getTime();
              const dueTime = new Date(r.dueDate).getTime();
              if (compTime <= dueTime) onTime++;
            }
          }
        });
      }
    });

    const completionRate = total > 0 ? (completed / total) * 100 : 0;
    const slaCompliance = completed > 0 ? (onTime / completed) * 100 : 100;
    
    // Mock simple score computation to avoid calling countDocuments in a loop
    const score = Math.round((completionRate * 0.5) + (slaCompliance * 0.5));
    agentScoreList.push({
      agentId: agent._id.toString(),
      name: agent.name,
      score,
      completed
    });
  }

  // Sort descending
  agentScoreList.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.completed - a.completed;
  });

  const rankIdx = agentScoreList.findIndex(a => a.agentId === agentId.toString());
  const rank = rankIdx !== -1 ? rankIdx + 1 : activeAgents.length;
  const percentile = activeAgents.length > 1 
    ? Math.round(((activeAgents.length - rank) / (activeAgents.length - 1)) * 100) 
    : 100;

  return {
    rank,
    totalAgents: activeAgents.length,
    percentile
  };
};

module.exports = {
  fetchAgentRecords,
  calculateCompletionRate,
  calculateSLACompliance,
  calculateAverageResolutionTime,
  calculateWeeklyPerformance,
  calculateMonthlyPerformance,
  calculateProductivityScore,
  calculateTeamRanking
};
