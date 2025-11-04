const { calculateSLA } = require('./slaCalculator');

/**
 * Computes workload statistics for a set of agents based on active distributions.
 * @param {Array} distributions - List of all distribution documents
 * @param {Array} agents - List of active agent user documents
 * @returns {Array} List of workload metrics per agent
 */
const calculateAgentWorkload = (distributions, agents) => {
  return agents.map(agent => {
    let totalAssigned = 0;
    let activeTasks = 0;
    let completedTasks = 0;
    let overdueTasks = 0;
    let criticalTasks = 0;

    const agentIdStr = agent._id.toString();

    // Iterate through all distributions to aggregate record tasks assigned to this agent
    distributions.forEach(dist => {
      const distAgent = dist.agents?.find(a => (a.agentId?._id || a.agentId || '').toString() === agentIdStr);
      if (distAgent && distAgent.records) {
        distAgent.records.forEach(record => {
          totalAssigned++;
          
          // Categorize status
          if (record.status === 'pending' || record.status === 'in-progress') {
            activeTasks++;
            
            // Re-calculate SLA status dynamically to ensure accuracy
            const currentSLA = calculateSLA(record);
            if (currentSLA === 'overdue') {
              overdueTasks++;
            }
            if (record.priority === 'critical') {
              criticalTasks++;
            }
          } else if (record.status === 'completed') {
            completedTasks++;
          }
        });
      }
    });

    // Compute completion rate: if no tasks are assigned, completion rate is 100%
    const completionRate = totalAssigned > 0 ? (completedTasks / totalAssigned) * 100 : 100;

    // Apply Health Score: base 100 minus penalties for overdue, critical, and incomplete tasks
    // Deduct 5 points per overdue task, 2 points per critical task, and 0.5 points per percentage under 100% completion
    const incompleteRate = 100 - completionRate;
    const healthScore = Math.max(0, Math.min(100, Math.round(
      100 - (overdueTasks * 5) - (criticalTasks * 2) - (incompleteRate * 0.5)
    )));

    // Classify health status based on score
    let status = 'Healthy';
    if (healthScore < 50) {
      status = 'Overloaded';
    } else if (healthScore < 80) {
      status = 'Moderate';
    }

    return {
      agentId: agent._id,
      name: agent.name,
      email: agent.email,
      totalAssigned,
      activeTasks,
      completedTasks,
      overdueTasks,
      criticalTasks,
      completionRate: Math.round(completionRate * 10) / 10,
      healthScore,
      status
    };
  });
};

module.exports = {
  calculateAgentWorkload
};
