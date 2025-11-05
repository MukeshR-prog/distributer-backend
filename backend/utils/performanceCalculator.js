const PerformanceSnapshot = require('../models/PerformanceSnapshot');

/**
 * Gets the week start date (Monday at 00:00:00) for a given date.
 */
const getWeekStartDate = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  // Adjust day to make Monday = 0, Sunday = 6
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(d.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
};

/**
 * Gets the performance grade based on score.
 */
const getPerformanceGrade = (score) => {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  return 'D';
};

/**
 * Checks if a task was overdue as of a certain date limit.
 */
const isOverdueAsOf = (record, dateLimit) => {
  if (!record.dueDate) return false;
  const dueDate = new Date(record.dueDate);

  // If completed on or before dateLimit, was it completed after due date?
  if (record.status === 'completed' && record.completedAt && record.completedAt <= dateLimit) {
    return new Date(record.completedAt) > dueDate;
  }

  // If active/pending or completed after dateLimit, check if dateLimit itself is past due date
  return dateLimit > dueDate;
};

/**
 * Calculates metrics and performance score for a specific agent as of a date limit.
 */
const calculateAgentPerformanceAsOf = (agentId, distributions, dateLimit) => {
  const agentIdStr = agentId.toString();
  
  let totalAssigned = 0;
  let completedTasks = 0;
  let overdueTasks = 0;
  let criticalAssigned = 0;
  let criticalCompleted = 0;
  let nonPendingTasks = 0;
  let totalResolutionTimeMs = 0;

  distributions.forEach(dist => {
    const distAgent = dist.agents?.find(a => (a.agentId?._id || a.agentId || '').toString() === agentIdStr);
    if (distAgent && distAgent.records) {
      distAgent.records.forEach(record => {
        const assignedAt = new Date(record.assignedAt || dist.createdAt);
        // Only consider records assigned on or before the dateLimit
        if (assignedAt <= dateLimit) {
          totalAssigned++;

          // Check if completed on or before dateLimit
          const isCompletedByLimit = record.status === 'completed' && record.completedAt && new Date(record.completedAt) <= dateLimit;
          
          if (isCompletedByLimit) {
            completedTasks++;
            const compTime = new Date(record.completedAt);
            const resTimeMs = compTime.getTime() - assignedAt.getTime();
            totalResolutionTimeMs += Math.max(0, resTimeMs);
          }

          // Check overdue status as of dateLimit
          if (isOverdueAsOf(record, dateLimit)) {
            overdueTasks++;
          }

          // Critical priority tracking
          if (record.priority === 'critical') {
            criticalAssigned++;
            if (isCompletedByLimit) {
              criticalCompleted++;
            }
          }

          // Check if it has moved out of pending status (or was completed by limit)
          if (record.status !== 'pending' || isCompletedByLimit) {
            nonPendingTasks++;
          }
        }
      });
    }
  });

  // Calculate percentages (0 to 100)
  const completionRate = totalAssigned > 0 ? (completedTasks / totalAssigned) * 100 : 100;
  const slaComplianceRate = totalAssigned > 0 ? ((totalAssigned - overdueTasks) / totalAssigned) * 100 : 100;
  const overduePercentage = totalAssigned > 0 ? (overdueTasks / totalAssigned) * 100 : 0;
  const criticalTaskHandlingRate = criticalAssigned > 0 ? (criticalCompleted / criticalAssigned) * 100 : 100;
  const activityParticipationRate = totalAssigned > 0 ? (nonPendingTasks / totalAssigned) * 100 : 100;
  
  const averageResolutionTime = completedTasks > 0 ? (totalResolutionTimeMs / (1000 * 60 * 60 * completedTasks)) : 0;

  // Formula:
  // Performance Score = (Completion Rate × 0.35) + (SLA Compliance × 0.35) + (Critical Task Handling × 0.20) + (Activity Participation × 0.10)
  let performanceScore = 0;
  if (totalAssigned > 0) {
    performanceScore = Math.max(0, Math.min(100, Math.round(
      (completionRate * 0.35) +
      (slaComplianceRate * 0.35) +
      (criticalTaskHandlingRate * 0.20) +
      (activityParticipationRate * 0.10)
    )));
  }

  const grade = getPerformanceGrade(performanceScore);

  return {
    totalAssigned,
    completedTasks,
    overdueTasks,
    completionRate: Math.round(completionRate * 10) / 10,
    slaComplianceRate: Math.round(slaComplianceRate * 10) / 10,
    averageResolutionTime: Math.round(averageResolutionTime * 10) / 10, // in hours
    overduePercentage: Math.round(overduePercentage * 10) / 10,
    criticalTaskHandlingRate: Math.round(criticalTaskHandlingRate * 10) / 10,
    activityParticipationRate: Math.round(activityParticipationRate * 10) / 10,
    performanceScore,
    grade
  };
};

/**
 * Automatically backfills snapshots for the last 6 weeks.
 */
const backfillSnapshots = async (distributions, agents) => {
  const currentMonday = getWeekStartDate(new Date());
  const snapshots = [];

  // Loop back 6 weeks
  for (let i = 1; i <= 6; i++) {
    const weekStart = new Date(currentMonday.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

    for (const agent of agents) {
      const existing = await PerformanceSnapshot.findOne({
        agentId: agent._id,
        weekStartDate: weekStart
      });

      if (!existing) {
        const metrics = calculateAgentPerformanceAsOf(agent._id, distributions, weekEnd);
        
        // If agent has no tasks assigned, we can still save a snapshot with default values
        const newSnapshot = await PerformanceSnapshot.create({
          agentId: agent._id,
          weekStartDate: weekStart,
          metrics
        });
        snapshots.push(newSnapshot);
      } else {
        snapshots.push(existing);
      }
    }
  }
  return snapshots;
};

module.exports = {
  getWeekStartDate,
  getPerformanceGrade,
  calculateAgentPerformanceAsOf,
  backfillSnapshots
};
