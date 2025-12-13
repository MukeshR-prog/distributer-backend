const User = require('../models/User');
const Distribution = require('../models/Distribution');
const ActivityLog = require('../models/ActivityLog');

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

module.exports = {
  fetchAgentRecords,
  calculateCompletionMetrics,
  calculateSLAMetrics,
  calculateResolutionMetrics,
  calculateProductivityScore
};
