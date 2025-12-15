const User = require('../models/User');
const Distribution = require('../models/Distribution');
const ActivityLog = require('../models/ActivityLog');
const AgentPerformanceSnapshot = require('../models/AgentPerformanceSnapshot');

/**
 * Utility function to fetch all records assigned to a specific agent across all distributions.
 * @param {String} agentId - ID of the agent user
 * @returns {Promise<Array>} Array of records with status, priority, and date metadata
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
 * Calculates completion metrics for an agent.
 * @param {String} agentId - Agent User ID
 * @returns {Promise<Object>} Completion metrics: totalAssigned, completed, pending, completionRate
 */
const calculateCompletionMetrics = async (agentId) => {
  const records = await fetchAgentRecords(agentId);
  const totalAssigned = records.length;
  const completed = records.filter(r => r.status === 'completed').length;
  const pending = records.filter(r => r.status === 'pending').length;
  const completionRate = totalAssigned > 0 ? Math.round((completed / totalAssigned) * 100) : 0;

  return {
    totalAssigned,
    completed,
    pending,
    completionRate
  };
};

/**
 * Calculates SLA compliance metrics for completed tasks.
 * @param {String} agentId - Agent User ID
 * @returns {Promise<Object>} SLA metrics: onTimeCompleted, lateCompleted, slaCompliance
 */
const calculateSLAMetrics = async (agentId) => {
  const records = await fetchAgentRecords(agentId);
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
 * Calculates task resolution speed in hours.
 * @param {String} agentId - Agent User ID
 * @returns {Promise<Object>} Resolution speed metrics: averageResolutionHours, fastestResolutionHours, slowestResolutionHours
 */
const calculateResolutionMetrics = async (agentId) => {
  const records = await fetchAgentRecords(agentId);
  const completedTasks = records.filter(r => r.status === 'completed' && r.assignedAt && (r.completedAt || r.updatedAt));

  if (completedTasks.length === 0) {
    return {
      averageResolutionHours: 0,
      fastestResolutionHours: 0,
      slowestResolutionHours: 0
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
    averageResolutionHours: Math.round((totalHours / completedTasks.length) * 10) / 10,
    fastestResolutionHours: fastest === Infinity ? 0 : Math.round(fastest * 10) / 10,
    slowestResolutionHours: slowest === -Infinity ? 0 : Math.round(slowest * 10) / 10
  };
};

/**
 * Calculates a consolidated productivity score and grade based on weighted performance components.
 * Formula: Completion Rate * 40% + SLA Compliance * 35% + Activity Participation * 15% + Resolution Speed * 10%
 * @param {String} agentId - Agent User ID
 * @returns {Promise<Object>} Productivity score metrics: score, grade
 */
const calculateProductivityScore = async (agentId) => {
  const completion = await calculateCompletionMetrics(agentId);
  const sla = await calculateSLAMetrics(agentId);
  const resolution = await calculateResolutionMetrics(agentId);

  const completionRate = completion.completionRate;
  const slaCompliance = sla.slaCompliance;

  // 1. Calculate Activity Participation (15%)
  // Query activities created in the last 30 days where performedBy is the agentId.
  // Standard benchmark: 30 activities in 30 days = 100% participation.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const activityCount = await ActivityLog.countDocuments({
    performedBy: agentId,
    createdAt: { $gte: thirtyDaysAgo }
  });
  const activityParticipation = Math.min(Math.round((activityCount / 30) * 100), 100);

  // 2. Calculate Resolution Speed score (10%)
  const avgRes = resolution.averageResolutionHours;
  let resolutionSpeedScore = 0;
  if (avgRes > 0) {
    if (avgRes <= 2) resolutionSpeedScore = 100;
    else if (avgRes <= 6) resolutionSpeedScore = 90;
    else if (avgRes <= 12) resolutionSpeedScore = 80;
    else if (avgRes <= 24) resolutionSpeedScore = 70;
    else if (avgRes <= 48) resolutionSpeedScore = 50;
    else resolutionSpeedScore = 30;
  } else {
    resolutionSpeedScore = 100; // Optimal / default baseline if no tasks
  }

  // 3. Consolidated Score logic
  const score = Math.round(
    (completionRate * 0.40) +
    (slaCompliance * 0.35) +
    (activityParticipation * 0.15) +
    (resolutionSpeedScore * 0.10)
  );

  // 4. Score grading bounds
  let grade = 'D';
  if (score >= 95) grade = 'A+';
  else if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';

  return {
    score,
    grade
  };
};

// Helper to fetch all records from all distributions grouped by agent ID
const fetchAllAgentsRecords = async () => {
  const distributions = await Distribution.find({});
  const agentRecordsMap = {};
  distributions.forEach(dist => {
    if (dist.agents) {
      dist.agents.forEach(agentData => {
        const agentIdStr = agentData.agentId.toString();
        if (!agentRecordsMap[agentIdStr]) {
          agentRecordsMap[agentIdStr] = [];
        }
        if (agentData.records) {
          agentData.records.forEach(r => {
            agentRecordsMap[agentIdStr].push({
              ...r.toObject ? r.toObject() : JSON.parse(JSON.stringify(r)),
              distributionId: dist._id,
              distributionName: dist.fileName
            });
          });
        }
      });
    }
  });
  return agentRecordsMap;
};

// Helper to fetch all activity logs grouped by agent ID since a specific date
const fetchAllAgentsActivities = async (sinceDate) => {
  const activities = await ActivityLog.find({ createdAt: { $gte: sinceDate } });
  const agentActivitiesMap = {};
  activities.forEach(act => {
    if (act.performedBy) {
      const agentIdStr = act.performedBy.toString();
      if (!agentActivitiesMap[agentIdStr]) {
        agentActivitiesMap[agentIdStr] = [];
      }
      agentActivitiesMap[agentIdStr].push(act);
    }
  });
  return agentActivitiesMap;
};

// Core mathematical evaluation engine for productivity scores as of a target day limit
const calculateProductivityScoreAsOf = (agentId, dayLimit, records, activities) => {
  const targetTime = dayLimit.getTime();
  const filteredRecords = records.filter(r => new Date(r.assignedAt).getTime() <= targetTime);
  const totalAssigned = filteredRecords.length;
  const completedTasks = filteredRecords.filter(r => r.status === 'completed' && r.completedAt && new Date(r.completedAt).getTime() <= targetTime);
  const completedCount = completedTasks.length;

  const completionRate = totalAssigned > 0 ? Math.round((completedCount / totalAssigned) * 100) : 0;

  let onTimeCompleted = 0;
  completedTasks.forEach(r => {
    if (!r.dueDate) {
      onTimeCompleted++;
    } else {
      const completedTime = new Date(r.completedAt).getTime();
      const dueTime = new Date(r.dueDate).getTime();
      if (completedTime <= dueTime) {
        onTimeCompleted++;
      }
    }
  });
  const slaCompliance = completedCount > 0 ? Math.round((onTimeCompleted / completedCount) * 100) : 100;

  const thirtyDaysAgoLimit = new Date(dayLimit);
  thirtyDaysAgoLimit.setDate(thirtyDaysAgoLimit.getDate() - 30);
  thirtyDaysAgoLimit.setHours(0, 0, 0, 0);
  const thirtyDaysAgoTime = thirtyDaysAgoLimit.getTime();

  const activityCount = activities.filter(a => {
    const actTime = new Date(a.createdAt).getTime();
    return actTime >= thirtyDaysAgoTime && actTime <= targetTime;
  }).length;
  const activityParticipation = Math.min(Math.round((activityCount / 30) * 100), 100);

  let resolutionSpeedScore = 100;
  if (completedCount > 0) {
    let totalHours = 0;
    completedTasks.forEach(r => {
      const assignedTime = new Date(r.assignedAt).getTime();
      const completedTime = new Date(r.completedAt).getTime();
      const diffHours = (completedTime - assignedTime) / (1000 * 60 * 60);
      totalHours += diffHours;
    });
    const avgRes = totalHours / completedCount;
    if (avgRes <= 2) resolutionSpeedScore = 100;
    else if (avgRes <= 6) resolutionSpeedScore = 90;
    else if (avgRes <= 12) resolutionSpeedScore = 80;
    else if (avgRes <= 24) resolutionSpeedScore = 70;
    else if (avgRes <= 48) resolutionSpeedScore = 50;
    else resolutionSpeedScore = 30;
  }

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
    completionRate,
    slaCompliance,
    completedTasks: completedCount
  };
};

// Computes the score/ranking variables for all active agents on a specific date in memory
const calculateAllAgentsScoresAsOf = (dayLimit, agents, agentRecordsMap, agentActivitiesMap) => {
  return agents.map(agent => {
    const agentIdStr = agent._id.toString();
    const records = agentRecordsMap[agentIdStr] || [];
    const activities = agentActivitiesMap[agentIdStr] || [];
    const metrics = calculateProductivityScoreAsOf(agent._id, dayLimit, records, activities);
    return {
      agentId: agentIdStr,
      team: agent.team,
      department: agent.department,
      score: metrics.score + metrics.completionRate + metrics.slaCompliance,
      metrics
    };
  }).sort((a, b) => b.score - a.score);
};

// Automates snapshot generation and backfills data history for the last 14 days + 8 weeks + 30 days ago
const ensureSnapshotsForAgent = async (agentId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDates = [];

  // Weekly Trend covers 14 days (today to 13 days ago)
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    targetDates.push(d);
  }

  // Monthly Trend covers 8 weeks (weekly intervals, today to 49 days ago)
  for (let i = 0; i < 8; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i * 7);
    if (!targetDates.some(existing => existing.getTime() === d.getTime())) {
      targetDates.push(d);
    }
  }

  // Delta comparison baseline is 30 days ago
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  if (!targetDates.some(existing => existing.getTime() === thirtyDaysAgo.getTime())) {
    targetDates.push(thirtyDaysAgo);
  }

  const existingSnaps = await AgentPerformanceSnapshot.find({
    agentId,
    generatedAt: { $in: targetDates }
  });

  const missingDates = targetDates.filter(d => !existingSnaps.some(s => s.generatedAt.getTime() === d.getTime()));

  if (missingDates.length > 0) {
    const agents = await User.find({ role: 'agent', isActive: true });
    const agentRecordsMap = await fetchAllAgentsRecords();

    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(today.getDate() - 60);
    sixtyDaysAgo.setHours(0, 0, 0, 0);
    const agentActivitiesMap = await fetchAllAgentsActivities(sixtyDaysAgo);

    for (const missingDate of missingDates) {
      const dayLimit = new Date(missingDate);
      dayLimit.setHours(23, 59, 59, 999);

      const scores = calculateAllAgentsScoresAsOf(dayLimit, agents, agentRecordsMap, agentActivitiesMap);
      const targetScoreInfo = scores.find(s => s.agentId === agentId.toString());

      if (targetScoreInfo) {
        const targetRank = scores.findIndex(s => s.agentId === agentId.toString()) + 1;
        await AgentPerformanceSnapshot.create({
          agentId,
          generatedAt: missingDate,
          productivityScore: targetScoreInfo.metrics.score,
          completionRate: targetScoreInfo.metrics.completionRate,
          slaCompliance: targetScoreInfo.metrics.slaCompliance,
          completedTasks: targetScoreInfo.metrics.completedTasks,
          rank: targetRank
        });
      }
    }
  }
};

// Computes current global, department, and team rank for the target agent
const calculateAgentRanking = async (agentId) => {
  const targetAgent = await User.findById(agentId);
  if (!targetAgent) {
    return { teamRank: 0, departmentRank: 0, globalRank: 0, totalAgents: 0 };
  }

  const agents = await User.find({ role: 'agent', isActive: true });
  const agentRecordsMap = await fetchAllAgentsRecords();

  const today = new Date();
  const sixtyDaysAgo = new Date(today);
  sixtyDaysAgo.setDate(today.getDate() - 60);
  sixtyDaysAgo.setHours(0, 0, 0, 0);
  const agentActivitiesMap = await fetchAllAgentsActivities(sixtyDaysAgo);

  const todayLimit = new Date();
  todayLimit.setHours(23, 59, 59, 999);

  const scores = calculateAllAgentsScoresAsOf(todayLimit, agents, agentRecordsMap, agentActivitiesMap);

  const globalRank = scores.findIndex(s => s.agentId === agentId.toString()) + 1;

  const teamScores = scores.filter(s => s.team === targetAgent.team);
  const teamRank = teamScores.findIndex(s => s.agentId === agentId.toString()) + 1;

  const deptScores = scores.filter(s => s.department === targetAgent.department);
  const departmentRank = deptScores.findIndex(s => s.agentId === agentId.toString()) + 1;

  return {
    teamRank,
    departmentRank,
    globalRank,
    totalAgents: agents.length
  };
};

// Generates 14 days of historical daily completion & score values
const calculateWeeklyTrend = async (agentId) => {
  await ensureSnapshotsForAgent(agentId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fourteenDaysAgo = new Date(today);
  fourteenDaysAgo.setDate(today.getDate() - 13);

  const snapshots = await AgentPerformanceSnapshot.find({
    agentId,
    generatedAt: { $gte: fourteenDaysAgo, $lte: today }
  }).sort({ generatedAt: 1 });

  return snapshots.map(s => {
    const year = s.generatedAt.getFullYear();
    const month = String(s.generatedAt.getMonth() + 1).padStart(2, '0');
    const day = String(s.generatedAt.getDate()).padStart(2, '0');
    return {
      date: `${year}-${month}-${day}`,
      completed: s.completedTasks,
      score: s.productivityScore
    };
  });
};

// Generates 8 weeks of historical scores
const calculateMonthlyTrend = async (agentId) => {
  await ensureSnapshotsForAgent(agentId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDates = Array.from({ length: 8 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i * 7);
    return d;
  });

  const snapshots = await AgentPerformanceSnapshot.find({
    agentId,
    generatedAt: { $in: targetDates }
  }).sort({ generatedAt: 1 });

  return snapshots.map((s, idx) => {
    return {
      week: `Week ${idx + 1}`,
      score: s.productivityScore
    };
  });
};

// Compares current performance parameters against 30 days ago baseline
const calculateImprovementMetrics = async (agentId) => {
  await ensureSnapshotsForAgent(agentId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const currentSnap = await AgentPerformanceSnapshot.findOne({ agentId, generatedAt: today });
  const previousSnap = await AgentPerformanceSnapshot.findOne({ agentId, generatedAt: thirtyDaysAgo });

  const currentScore = currentSnap ? currentSnap.productivityScore : 0;
  const previousScore = previousSnap ? previousSnap.productivityScore : 0;

  const currentRank = currentSnap ? currentSnap.rank : 1;
  const previousRank = previousSnap ? previousSnap.rank : 1;

  const scoreDiff = currentScore - previousScore;
  const rankMovement = previousRank - currentRank;

  const currentComp = currentSnap ? currentSnap.completionRate : 0;
  const previousComp = previousSnap ? previousSnap.completionRate : 0;
  const compDiff = currentComp - previousComp;

  const currentSla = currentSnap ? currentSnap.slaCompliance : 100;
  const previousSla = previousSnap ? previousSnap.slaCompliance : 100;
  const slaDiff = currentSla - previousSla;

  return {
    improvementPercent: Math.abs(scoreDiff),
    direction: scoreDiff >= 0 ? "up" : "down",
    previousRank,
    currentRank,
    rankMovement: Math.abs(rankMovement),
    rankMovementDirection: rankMovement > 0 ? "up" : (rankMovement < 0 ? "down" : "stable"),
    completionChange: Math.abs(compDiff),
    completionDirection: compDiff >= 0 ? "up" : "down",
    slaChange: Math.abs(slaDiff),
    slaDirection: slaDiff >= 0 ? "up" : "down"
  };
};

// Computes best milestone values for the target agent
const calculatePersonalBests = async (agentId) => {
  const snapshots = await AgentPerformanceSnapshot.find({ agentId });
  const records = await fetchAgentRecords(agentId);
  const completed = records.filter(r => r.status === 'completed' && r.completedAt);

  // 1. Highest Productivity Score
  const highestScore = snapshots.length > 0 ? Math.max(...snapshots.map(s => s.productivityScore)) : 0;

  // 2. Best Completion Day (date with most tasks completed)
  const bestDaySnap = snapshots.length > 0 ? snapshots.reduce((prev, curr) => (curr.completedTasks > prev.completedTasks ? curr : prev), snapshots[0]) : null;
  let bestCompletionDay = "N/A";
  let bestCompletionCount = 0;
  if (bestDaySnap && bestDaySnap.completedTasks > 0) {
    const year = bestDaySnap.generatedAt.getFullYear();
    const month = String(bestDaySnap.generatedAt.getMonth() + 1).padStart(2, '0');
    const day = String(bestDaySnap.generatedAt.getDate()).padStart(2, '0');
    bestCompletionDay = `${year}-${month}-${day}`;
    bestCompletionCount = bestDaySnap.completedTasks;
  }

  // 3. Longest Completion Streak (consecutive days with at least one task completed)
  const compDates = completed.map(r => {
    const d = new Date(r.completedAt);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
  const sortedDates = [...new Set(compDates)].sort((a, b) => a - b);

  let longestStreak = 0;
  let currentStreak = 0;
  let lastTime = null;

  sortedDates.forEach(time => {
    if (lastTime === null) {
      currentStreak = 1;
    } else {
      const diffDays = (time - lastTime) / (1000 * 60 * 60 * 24);
      if (diffDays === 1) {
        currentStreak++;
      } else if (diffDays > 1) {
        if (currentStreak > longestStreak) {
          longestStreak = currentStreak;
        }
        currentStreak = 1;
      }
    }
    lastTime = time;
  });
  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }

  // 4. Fastest Resolution Time
  const speedTasks = completed.filter(r => r.assignedAt);
  let fastestResolutionHours = 0;
  if (speedTasks.length > 0) {
    const speeds = speedTasks.map(r => {
      const diff = (new Date(r.completedAt).getTime() - new Date(r.assignedAt).getTime()) / (1000 * 60 * 60);
      return Math.max(0, diff);
    });
    fastestResolutionHours = Math.min(...speeds);
    fastestResolutionHours = Math.round(fastestResolutionHours * 10) / 10;
  }

  return {
    highestScore,
    bestCompletionDay,
    bestCompletionCount,
    longestStreak,
    fastestResolutionHours
  };
};

module.exports = {
  fetchAgentRecords,
  calculateCompletionMetrics,
  calculateSLAMetrics,
  calculateResolutionMetrics,
  calculateProductivityScore,
  ensureSnapshotsForAgent,
  calculateAgentRanking,
  calculateWeeklyTrend,
  calculateMonthlyTrend,
  calculateImprovementMetrics,
  calculatePersonalBests
};

