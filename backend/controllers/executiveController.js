const { asyncHandler } = require('../middleware/errorHandler');
const { getExecutiveMetrics, getDepartmentPerformance } = require('../utils/executiveMetrics');
const { calculateAgentRiskAsOf } = require('../utils/riskCalculator');
const User = require('../models/User');
const Distribution = require('../models/Distribution');
const AutomationRule = require('../models/AutomationRule');
const ExecutiveSnapshot = require('../models/ExecutiveSnapshot');
const AIInsightSnapshot = require('../models/AIInsightSnapshot');

/**
 * Helper to retrieve agent risk list for action center
 */
const getAgentsRiskDetails = async () => {
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});
  const agentDetails = [];

  for (const agent of agents) {
    const risk = calculateAgentRiskAsOf(agent._id, distributions, new Date());
    agentDetails.push({
      agentId: agent._id,
      name: agent.name,
      metrics: risk
    });
  }
  return { agents: agentDetails };
};

/**
 * Helper to fetch AI executive summary snapshots or default fallback instructions.
 */
const getAIExecutiveInsightsInternal = async () => {
  try {
    const latestSnapshot = await AIInsightSnapshot.findOne({
      insightType: 'executive-summary'
    }).sort({ generatedAt: -1 });

    if (latestSnapshot) {
      return {
        weeklySummary: latestSnapshot.summary,
        keyRisks: latestSnapshot.recommendations.filter(r => r.priority === 'High' || r.priority === 'Medium').map(r => r.recommendation),
        strategicRecommendations: latestSnapshot.recommendations.map(r => r.recommendation),
        confidence: latestSnapshot.confidence,
        generatedAt: latestSnapshot.generatedAt
      };
    }
  } catch (err) {
    console.error('[ExecutiveController] Error loading AI insights:', err);
  }

  // Fallback defaults
  return {
    weeklySummary: "Operations are running stable. SLA target compliance is maintained within optimal ranges across active regions.",
    keyRisks: [
      "Moderate pending workloads identified in General Operations departments.",
      "Workload capacity limits approaching for default teams."
    ],
    strategicRecommendations: [
      "Review automated rule triggers in the Automation Center to alert before SLA breaches.",
      "Monitor task routing metrics to ensure balanced queue depth allocation."
    ],
    confidence: 80,
    generatedAt: new Date()
  };
};

/**
 * Helper to compile dynamic, prioritized action items based on active system indicators.
 */
const compileExecutiveActions = (metrics, deptPerf, riskData) => {
  const actions = [];

  // Action 1: Overloaded agents
  const overloadedCount = riskData.agents.filter(a => a.metrics.activeTasks > 15).length;
  if (overloadedCount > 0) {
    actions.push({
      priorityLevel: 'Critical',
      action: `Reassign critical tasks from ${overloadedCount} overloaded agents.`,
      reason: 'Workload imbalance detected. Agents have exceeded maximum capacity threshold.',
      supportingMetrics: { 'Overloaded Agents': overloadedCount }
    });
  }

  // Action 2: Low SLA Compliance
  if (metrics.slaCompliance.currentValue < 90) {
    actions.push({
      priorityLevel: 'High',
      action: 'Investigate SLA compliance slippage in active queues.',
      reason: `Consolidated SLA compliance (${metrics.slaCompliance.currentValue}%) is running below the 90% SLA target threshold.`,
      supportingMetrics: { 'SLA Compliance': `${metrics.slaCompliance.currentValue}%` }
    });
  }

  // Action 3: Team performance declines
  const decliningTeams = deptPerf.filter(d => d.trend === 'Down' || d.performanceScore < 70);
  decliningTeams.forEach(team => {
    actions.push({
      priorityLevel: 'High',
      action: `Review performance decline in ${team.department} - ${team.team}.`,
      reason: `Team performance is low (${team.performanceScore}) with declining operational efficiency.`,
      supportingMetrics: { 'Performance Score': team.performanceScore, 'SLA': `${team.sla}%` }
    });
  });

  // Action 4: High risk agents
  const highRiskCount = riskData.agents.filter(a => a.metrics.riskCategory === 'Critical Risk' || a.metrics.riskCategory === 'High Risk').length;
  if (highRiskCount > 0) {
    actions.push({
      priorityLevel: 'Medium',
      action: `Conduct workload audit for ${highRiskCount} high-risk agents.`,
      reason: 'Agents have a high breach probability on approaching task deadlines.',
      supportingMetrics: { 'High Risk Agents': highRiskCount }
    });
  }

  // Action 5: Automation failures
  if (metrics.automationSuccessRate.currentValue < 95) {
    actions.push({
      priorityLevel: 'Medium',
      action: 'Review failed runs in the Automation Center.',
      reason: `Automation success rate (${metrics.automationSuccessRate.currentValue}%) is currently below operational targets.`,
      supportingMetrics: { 'Automation Success': `${metrics.automationSuccessRate.currentValue}%` }
    });
  }

  // Fallback defaults
  if (actions.length < 3) {
    actions.push({
      priorityLevel: 'Low',
      action: 'Optimize standard resource allocation guidelines.',
      reason: 'General weekly review to align agent queue allocations.',
      supportingMetrics: { 'Active Agents': metrics.activeAgents.currentValue }
    });
  }

  // Priority ranking
  const priorityRank = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
  return actions.sort((a, b) => priorityRank[b.priorityLevel] - priorityRank[a.priorityLevel]);
};

/**
 * @desc    Get consolidated executive dashboard analytics
 * @route   GET /api/executive/dashboard
 * @access  Private (Admin)
 */
const getExecutiveDashboard = asyncHandler(async (req, res) => {
  // 1. Gather KPIs and comparison trends
  const executiveMetrics = await getExecutiveMetrics();

  // 2. Gather Department Performance Breakdowns
  const departmentPerformance = await getDepartmentPerformance();

  // 3. Compile Business Health details
  const score = executiveMetrics.businessHealthScore.currentValue;
  let category = 'Good';
  if (score >= 90) category = 'Excellent';
  else if (score >= 80) category = 'Good';
  else if (score >= 70) category = 'Needs Attention';
  else category = 'Critical';

  // Compare score trend direction
  const healthDiff = score - executiveMetrics.businessHealthScore.previousValue;
  const trend = healthDiff > 0 ? 'Up' : healthDiff < 0 ? 'Down' : 'Stable';

  const businessHealth = {
    score,
    category,
    trend
  };

  // 4. Map Operational Risks Matrix (Low, Medium, High, Critical)
  const slaRiskScore = Math.max(0, 100 - executiveMetrics.slaCompliance.currentValue);
  const workloadRiskScore = Math.max(0, 100 - executiveMetrics.workloadHealthScore);
  const performanceRiskScore = Math.max(0, 100 - executiveMetrics.averagePerformanceScore);
  const automationRiskScore = Math.max(0, 100 - executiveMetrics.automationSuccessRate.currentValue);

  const mapRiskLevel = (val) => {
    if (val > 75) return 'Critical';
    if (val > 50) return 'High';
    if (val > 25) return 'Medium';
    return 'Low';
  };

  const operationalRisks = [
    { category: 'SLA', level: mapRiskLevel(slaRiskScore), score: slaRiskScore },
    { category: 'Workload', level: mapRiskLevel(workloadRiskScore), score: workloadRiskScore },
    { category: 'Performance', level: mapRiskLevel(performanceRiskScore), score: performanceRiskScore },
    { category: 'Automation', level: mapRiskLevel(automationRiskScore), score: automationRiskScore }
  ];

  // 5. Query last 30 daily snapshots for chart rendering
  const snapshots = await ExecutiveSnapshot.find({})
    .sort({ generatedAt: 1 })
    .limit(30);

  // 6. Gather AI summary Insights
  const aiInsights = await getAIExecutiveInsightsInternal();

  // 7. Compile prioritized Action Center items
  const riskData = await getAgentsRiskDetails();
  const executiveActions = compileExecutiveActions(executiveMetrics, departmentPerformance, riskData);

  res.status(200).json({
    success: true,
    data: {
      executiveMetrics,
      businessHealth,
      operationalRisks,
      departmentPerformance,
      aiInsights,
      executiveSnapshots: snapshots.map(s => ({
        date: s.generatedAt,
        businessHealthScore: s.businessHealthScore,
        slaCompliance: s.slaCompliance,
        riskScore: s.riskScore,
        automationSuccessRate: s.automationSuccessRate,
        aiAdoptionRate: s.aiAdoptionRate
      })),
      executiveActions
    }
  });
});

module.exports = {
  getExecutiveDashboard
};
