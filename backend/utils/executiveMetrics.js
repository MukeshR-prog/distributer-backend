const User = require('../models/User');
const Distribution = require('../models/Distribution');
const AutomationExecution = require('../models/AutomationExecution');
const AutomationRule = require('../models/AutomationRule');
const ExecutiveSnapshot = require('../models/ExecutiveSnapshot');
const { calculateAgentPerformanceAsOf } = require('./performanceCalculator');
const { calculateAgentRiskAsOf } = require('./riskCalculator');

/**
 * Calculates all executive level operational metrics for a specific date limit.
 */
const calculateExecutiveMetricsAtDate = async (dateLimit) => {
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});

  const totalActiveAgents = agents.length;

  // Total Tasks Managed (all time up to limit)
  let totalTasksManaged = 0;
  distributions.forEach(dist => {
    const distDate = new Date(dist.createdAt);
    if (distDate <= dateLimit) {
      totalTasksManaged += dist.totalRecords || 0;
    }
  });

  // Calculate Average SLA Compliance and Performance
  let totalSLACompliance = 0;
  let totalPerformanceScore = 0;
  let totalRiskScore = 0;
  let totalActiveTasks = 0;

  agents.forEach(agent => {
    const perf = calculateAgentPerformanceAsOf(agent._id, distributions, dateLimit);
    const risk = calculateAgentRiskAsOf(agent._id, distributions, dateLimit);

    totalSLACompliance += perf.slaComplianceRate;
    totalPerformanceScore += perf.performanceScore;
    totalRiskScore += risk.riskScore;
    totalActiveTasks += risk.activeTasks;
  });

  const averageSLACompliance = totalActiveAgents > 0 ? Math.round(totalSLACompliance / totalActiveAgents) : 100;
  const averagePerformanceScore = totalActiveAgents > 0 ? Math.round(totalPerformanceScore / totalActiveAgents) : 0;
  const organizationalRiskScore = totalActiveAgents > 0 ? Math.round(totalRiskScore / totalActiveAgents) : 0;

  // Automation Success Rate
  // Find executions up to dateLimit
  const executions = await AutomationExecution.find({
    executedAt: { $lte: dateLimit }
  }).sort({ executedAt: -1 }).limit(100);

  const successCount = executions.filter(e => e.executionStatus === 'Success').length;
  const automationSuccessRate = executions.length > 0 ? Math.round((successCount / executions.length) * 100) : 100;

  // AI Recommendation Adoption Rate
  const totalRecommended = 3;
  const adoptedCount = await AutomationRule.countDocuments({
    name: { $regex: /AI Recommended/i },
    createdAt: { $lte: dateLimit }
  });
  const aiAdoptionRate = Math.round((adoptedCount / totalRecommended) * 100);

  // Workload Health Score
  const avgWorkload = totalActiveAgents > 0 ? (totalActiveTasks / totalActiveAgents) : 0;
  const workloadHealthScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, avgWorkload - 10) * 5)));

  // Business Health Score
  const businessHealthScore = Math.max(0, Math.min(100, Math.round(
    (averageSLACompliance * 0.3) +
    ((100 - organizationalRiskScore) * 0.3) +
    (automationSuccessRate * 0.2) +
    (averagePerformanceScore * 0.2)
  )));

  return {
    totalActiveAgents,
    totalTasksManaged,
    averageSLACompliance,
    automationSuccessRate,
    aiAdoptionRate,
    workloadHealthScore,
    organizationalRiskScore,
    businessHealthScore,
    averagePerformanceScore
  };
};

/**
 * Backfills ExecutiveSnapshot records for the last 30 days.
 */
const backfillExecutiveSnapshots = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 30; i >= 1; i--) {
    const targetDate = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    targetDate.setHours(23, 59, 59, 999);

    // Look for snapshot generated on that day
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const existing = await ExecutiveSnapshot.findOne({
      generatedAt: { $gte: dayStart, $lte: dayEnd }
    });

    if (!existing) {
      const stats = await calculateExecutiveMetricsAtDate(targetDate);
      await ExecutiveSnapshot.create({
        generatedAt: targetDate,
        businessHealthScore: stats.businessHealthScore,
        slaCompliance: stats.averageSLACompliance,
        riskScore: stats.organizationalRiskScore,
        automationSuccessRate: stats.automationSuccessRate,
        aiAdoptionRate: stats.aiAdoptionRate
      });
    }
  }
};

/**
 * Calculates percentage change helper.
 */
const calculateChange = (current, previous) => {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 100 * 10) / 10;
};

/**
 * Fetches current executive metrics with historical trend comparison.
 */
const getExecutiveMetrics = async () => {
  // Ensure snapshots are backfilled
  await backfillExecutiveSnapshots();

  const now = new Date();
  const current = await calculateExecutiveMetricsAtDate(now);

  // Find previous snapshot (latest generated yesterday or older)
  const yesterdayEnd = new Date();
  yesterdayEnd.setHours(0, 0, 0, 0);

  const previousSnapshot = await ExecutiveSnapshot.findOne({
    generatedAt: { $lt: yesterdayEnd }
  }).sort({ generatedAt: -1 });

  const prev = previousSnapshot || {
    businessHealthScore: current.businessHealthScore,
    slaCompliance: current.averageSLACompliance,
    riskScore: current.organizationalRiskScore,
    automationSuccessRate: current.automationSuccessRate,
    aiAdoptionRate: current.aiAdoptionRate,
    totalActiveAgents: current.totalActiveAgents,
    totalTasksManaged: current.totalTasksManaged
  };

  // Build comparisons
  return {
    activeAgents: {
      currentValue: current.totalActiveAgents,
      previousValue: prev.totalActiveAgents || current.totalActiveAgents,
      percentageChange: calculateChange(current.totalActiveAgents, prev.totalActiveAgents || current.totalActiveAgents)
    },
    tasksManaged: {
      currentValue: current.totalTasksManaged,
      previousValue: prev.totalTasksManaged || current.totalTasksManaged,
      percentageChange: calculateChange(current.totalTasksManaged, prev.totalTasksManaged || current.totalTasksManaged)
    },
    slaCompliance: {
      currentValue: current.averageSLACompliance,
      previousValue: prev.slaCompliance,
      percentageChange: calculateChange(current.averageSLACompliance, prev.slaCompliance)
    },
    automationSuccessRate: {
      currentValue: current.automationSuccessRate,
      previousValue: prev.automationSuccessRate,
      percentageChange: calculateChange(current.automationSuccessRate, prev.automationSuccessRate)
    },
    aiAdoptionRate: {
      currentValue: current.aiAdoptionRate,
      previousValue: prev.aiAdoptionRate,
      percentageChange: calculateChange(current.aiAdoptionRate, prev.aiAdoptionRate)
    },
    businessHealthScore: {
      currentValue: current.businessHealthScore,
      previousValue: prev.businessHealthScore,
      percentageChange: calculateChange(current.businessHealthScore, prev.businessHealthScore)
    },
    workloadHealthScore: current.workloadHealthScore,
    organizationalRiskScore: current.organizationalRiskScore,
    averagePerformanceScore: current.averagePerformanceScore
  };
};

/**
 * Computes performance grouping by real department and team.
 */
const getDepartmentPerformance = async () => {
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});

  const departmentsMap = {};

  agents.forEach(agent => {
    const dept = agent.department || 'General Operations';
    const team = agent.team || 'Default Team';

    const perf = calculateAgentPerformanceAsOf(agent._id, distributions, new Date());
    const risk = calculateAgentRiskAsOf(agent._id, distributions, new Date());

    if (!departmentsMap[dept]) {
      departmentsMap[dept] = {};
    }

    if (!departmentsMap[dept][team]) {
      departmentsMap[dept][team] = {
        teamName: team,
        performanceSum: 0,
        slaSum: 0,
        riskSum: 0,
        count: 0
      };
    }

    departmentsMap[dept][team].performanceSum += perf.performanceScore;
    departmentsMap[dept][team].slaSum += perf.slaComplianceRate;
    departmentsMap[dept][team].riskSum += risk.riskScore;
    departmentsMap[dept][team].count++;
  });

  const departmentPerformance = [];

  Object.keys(departmentsMap).forEach(deptName => {
    Object.keys(departmentsMap[deptName]).forEach(teamName => {
      const teamData = departmentsMap[deptName][teamName];
      const avgPerformance = Math.round(teamData.performanceSum / teamData.count);
      const avgSLA = Math.round(teamData.slaSum / teamData.count);
      const avgRisk = Math.round(teamData.riskSum / teamData.count);

      let riskCategory = 'Low';
      if (avgRisk > 75) riskCategory = 'Critical';
      else if (avgRisk > 50) riskCategory = 'High';
      else if (avgRisk > 25) riskCategory = 'Medium';

      // Assign a stable trend based on SLA compliance
      let trend = 'Stable';
      if (avgSLA >= 93) trend = 'Up';
      else if (avgSLA < 80) trend = 'Down';

      departmentPerformance.push({
        department: deptName,
        team: teamName,
        performanceScore: avgPerformance,
        sla: avgSLA,
        risk: riskCategory,
        trend
      });
    });
  });

  // Ensure default fallback if no departments are computed
  if (departmentPerformance.length === 0) {
    departmentPerformance.push({
      department: 'General Operations',
      team: 'Default Team',
      performanceScore: 0,
      sla: 100,
      risk: 'Low',
      trend: 'Stable'
    });
  }

  return departmentPerformance;
};

module.exports = {
  getExecutiveMetrics,
  getDepartmentPerformance,
  calculateExecutiveMetricsAtDate
};
