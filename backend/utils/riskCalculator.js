const RiskSnapshot = require('../models/RiskSnapshot');

/**
 * Checks if a task was overdue as of a certain date limit.
 */
const isOverdueAsOf = (record, dateLimit) => {
  if (!record.dueDate) return false;
  const dueDate = new Date(record.dueDate);

  // If completed on or before dateLimit, was it completed after due date?
  if (record.status === 'completed' && record.completedAt && new Date(record.completedAt) <= dateLimit) {
    return new Date(record.completedAt) > dueDate;
  }

  // If active/pending or completed after dateLimit, check if dateLimit itself is past due date
  return dateLimit > dueDate;
};

/**
 * Checks if a task was approaching SLA deadline (less than 24h remaining) as of a certain date limit.
 */
const isApproachingAsOf = (record, dateLimit) => {
  if (!record.dueDate) return false;
  const dueDate = new Date(record.dueDate);

  // If already completed or overdue, it's not approaching deadline
  const isCompletedByLimit = record.status === 'completed' && record.completedAt && new Date(record.completedAt) <= dateLimit;
  if (isCompletedByLimit || dateLimit > dueDate) {
    return false;
  }

  const timeRemainingMs = dueDate.getTime() - dateLimit.getTime();
  return timeRemainingMs > 0 && timeRemainingMs < 24 * 60 * 60 * 1000;
};

/**
 * Calculates risk indicators and overall Risk Score for an agent as of a date limit.
 */
const calculateAgentRiskAsOf = (agentId, distributions, dateLimit) => {
  const agentIdStr = agentId.toString();

  let totalAssigned = 0;
  let activeTasks = 0;
  let completedTasks = 0;
  let overdueTasks = 0;
  let approachingTasks = 0;
  let criticalActive = 0;
  let highActive = 0;

  // Track task level arrays to compute averages
  const activeTaskRisks = [];

  distributions.forEach(dist => {
    const distAgent = dist.agents?.find(a => (a.agentId?._id || a.agentId || '').toString() === agentIdStr);
    if (distAgent && distAgent.records) {
      distAgent.records.forEach(record => {
        const assignedAt = new Date(record.assignedAt || dist.createdAt);
        
        // Only consider records assigned on or before dateLimit
        if (assignedAt <= dateLimit) {
          totalAssigned++;

          // Check if completed on or before dateLimit
          const isCompletedByLimit = record.status === 'completed' && record.completedAt && new Date(record.completedAt) <= dateLimit;

          if (isCompletedByLimit) {
            completedTasks++;
          } else {
            // Active task as of dateLimit
            activeTasks++;

            if (record.priority === 'critical') criticalActive++;
            if (record.priority === 'high') highActive++;

            // SLA Breach Probability calculation for this specific task
            let taskBreachProb = 10; // baseline
            if (isOverdueAsOf(record, dateLimit)) {
              taskBreachProb = 100;
            } else if (record.dueDate) {
              const timeRemainingMs = new Date(record.dueDate).getTime() - dateLimit.getTime();
              if (timeRemainingMs <= 0) {
                taskBreachProb = 100;
              } else if (timeRemainingMs < 2 * 60 * 60 * 1000) { // < 2 hours
                taskBreachProb = 95;
              } else if (timeRemainingMs < 12 * 60 * 60 * 1000) { // < 12 hours
                taskBreachProb = 75;
              } else if (timeRemainingMs < 24 * 60 * 60 * 1000) { // < 24 hours
                taskBreachProb = 50;
              } else if (timeRemainingMs < 48 * 60 * 60 * 1000) { // < 48 hours
                taskBreachProb = 25;
              }
            }

            // Adjust for priority
            if (record.priority === 'critical') {
              taskBreachProb = Math.min(100, taskBreachProb + 15);
            } else if (record.priority === 'high') {
              taskBreachProb = Math.min(100, taskBreachProb + 10);
            } else if (record.priority === 'medium') {
              taskBreachProb = Math.min(100, taskBreachProb + 5);
            }

            // Escalation risk score for this task
            let taskEscalationRisk = 10;
            if (isOverdueAsOf(record, dateLimit)) {
              if (record.priority === 'critical') {
                taskEscalationRisk = 100;
              } else {
                const timeOverdueMs = dateLimit.getTime() - new Date(record.dueDate).getTime();
                const overdueHours = timeOverdueMs / (1000 * 60 * 60);
                if (overdueHours > 24) {
                  taskEscalationRisk = 90;
                } else if (overdueHours > 12) {
                  taskEscalationRisk = 75;
                } else {
                  taskEscalationRisk = 50;
                }
              }
            } else if (record.dueDate) {
              const timeRemainingMs = new Date(record.dueDate).getTime() - dateLimit.getTime();
              if (timeRemainingMs < 24 * 60 * 60 * 1000) {
                taskEscalationRisk = 60;
              } else if (timeRemainingMs < 48 * 60 * 60 * 1000) {
                taskEscalationRisk = 30;
              }
            }

            activeTaskRisks.push({ breach: taskBreachProb, escalation: taskEscalationRisk });
          }

          // Check overdue status as of dateLimit
          if (isOverdueAsOf(record, dateLimit)) {
            overdueTasks++;
          }

          // Check approaching status as of dateLimit
          if (isApproachingAsOf(record, dateLimit)) {
            approachingTasks++;
          }
        }
      });
    }
  });

  // Calculate average indicators
  const slaBreachProbability = activeTaskRisks.length > 0 
    ? Math.round(activeTaskRisks.reduce((sum, item) => sum + item.breach, 0) / activeTaskRisks.length) 
    : 0;

  const escalationRisk = activeTaskRisks.length > 0 
    ? Math.round(activeTaskRisks.reduce((sum, item) => sum + item.escalation, 0) / activeTaskRisks.length) 
    : 0;

  // Capacity Load Overload Risk: base active tasks count multiplier
  const agentOverloadRisk = Math.min(100, activeTasks * 10);

  // Distribution Risk: percentage of high/critical priority tasks in current active queue
  const distributionRisk = activeTasks > 0 
    ? Math.round(((criticalActive + highActive) / activeTasks) * 100) 
    : 0;

  // Formula:
  // Risk Score = (SLA Breach Probability * 0.40) + (Escalation Risk * 0.30) + (Agent Overload Risk * 0.20) + (Distribution Risk * 0.10)
  let riskScore = 0;
  if (activeTasks > 0) {
    riskScore = Math.max(0, Math.min(100, Math.round(
      (slaBreachProbability * 0.40) +
      (escalationRisk * 0.30) +
      (agentOverloadRisk * 0.20) +
      (distributionRisk * 0.10)
    )));
  }

  // Categories
  let riskCategory = 'Low Risk';
  if (riskScore > 75) {
    riskCategory = 'Critical Risk';
  } else if (riskScore > 50) {
    riskCategory = 'High Risk';
  } else if (riskScore > 25) {
    riskCategory = 'Medium Risk';
  }

  // Generate predictive suggestions
  const recommendations = [];
  if (agentOverloadRisk >= 50) {
    recommendations.push("Assign additional resources to balance workload queues.");
  }
  if (slaBreachProbability >= 50 && criticalActive > 0) {
    recommendations.push("Reassign critical tasks from this agent to prevent SLA breaches.");
  }
  if (activeTasks > 0) {
    // Check if any active task is approaching breach within 24 hours
    const hasImpendingEscalation = approachingTasks > 0;
    if (hasImpendingEscalation) {
      recommendations.push("Escalation likely within 24 hours: prioritize task immediately.");
    }
  }

  return {
    totalAssigned,
    activeTasks,
    completedTasks,
    overdueTasks,
    approachingTasks,
    criticalActive,
    highActive,
    slaBreachProbability,
    escalationRisk,
    agentOverloadRisk,
    distributionRisk,
    riskScore,
    riskCategory,
    recommendations
  };
};

/**
 * Automatically backfills snapshots for the last 7 days.
 */
const backfillRiskSnapshots = async (distributions, agents) => {
  const snapshots = [];
  const today = new Date();

  // Loop back 7 days
  for (let i = 1; i <= 7; i++) {
    const dayDate = new Date(today);
    dayDate.setDate(today.getDate() - i);
    
    // Set to 00:00:00 for the database daily index key
    const dateKey = new Date(dayDate);
    dateKey.setHours(0, 0, 0, 0);

    // Limit calculation to the end of that day
    const dateLimit = new Date(dayDate);
    dateLimit.setHours(23, 59, 59, 999);

    for (const agent of agents) {
      const existing = await RiskSnapshot.findOne({
        agentId: agent._id,
        date: dateKey
      });

      if (!existing) {
        const metrics = calculateAgentRiskAsOf(agent._id, distributions, dateLimit);
        
        const newSnapshot = await RiskSnapshot.create({
          agentId: agent._id,
          date: dateKey,
          riskScore: metrics.riskScore,
          workload: {
            totalAssigned: metrics.totalAssigned,
            activeTasks: metrics.activeTasks
          },
          slaMetrics: {
            overdueCount: metrics.overdueTasks,
            approachingDeadlineCount: metrics.approachingTasks
          }
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
  calculateAgentRiskAsOf,
  backfillRiskSnapshots
};
