const User = require('../models/User');
const Distribution = require('../models/Distribution');
const RiskSnapshot = require('../models/RiskSnapshot');
const PerformanceSnapshot = require('../models/PerformanceSnapshot');
const AIInsightSnapshot = require('../models/AIInsightSnapshot');
const { asyncHandler } = require('../middleware/errorHandler');
const { fetchAgentAnalyticsDataInternal } = require('./analyticsController');
const { calculateAgentWorkload } = require('../utils/workloadCalculator');
const { calculateAgentPerformanceAsOf } = require('../utils/performanceCalculator');
const { calculateAgentRiskAsOf } = require('../utils/riskCalculator');
const { callGroq } = require('../services/groqService');
const { getInsightsPrompt, getCoachingPrompt, getExecutiveSummaryPrompt } = require('../prompts/operationsPrompts');

// 30-minute in-memory cache configuration
const CACHE_TTL = 30 * 60 * 1000;
const cache = {};
const inFlightRequests = {};

/**
 * Builds a unique cache key based on query params.
 */
const getCacheKey = (endpoint, dateRange = 'default', agentId = null) => {
  const agentPart = agentId ? `_agent_${agentId}` : '';
  return `ai_${endpoint}_${dateRange.replace(/[^a-zA-Z0-9]/g, '_')}${agentPart}`;
};

/**
 * Formats date range as a string for cache keys.
 */
const getDateRangeStr = (from, to) => {
  if (!from && !to) return 'alltime';
  return `${from || 'start'}_to_${to || 'end'}`;
};

/**
 * Helper to execute Groq request and handle DB logging and cache updates.
 */
const executeAIQuery = async ({ cacheKey, insightType, agentId, systemPrompt, userPrompt, sourceMetrics, fallbackGenerator }) => {
  // If there's an in-flight promise for this key, reuse it to prevent duplicate API requests
  if (inFlightRequests[cacheKey]) {
    return inFlightRequests[cacheKey];
  }

  const queryPromise = (async () => {
    let result = null;
    let isFallback = false;

    try {
      // Query Groq API
      const groqResponse = await callGroq(systemPrompt, userPrompt);
      
      // Validate response structure
      if (
        typeof groqResponse.confidence === 'number' &&
        typeof groqResponse.summary === 'string' &&
        Array.isArray(groqResponse.recommendations) &&
        typeof groqResponse.reasoning === 'string'
      ) {
        result = {
          ...groqResponse,
          source: 'ai',
          generatedAt: new Date()
        };
      } else {
        throw new Error('Groq response does not match the expected JSON schema');
      }
    } catch (err) {
      console.warn(`[AIController] Groq call failed, switching to fallback. Error: ${err.message}`);
      isFallback = true;
      const fallbackData = fallbackGenerator(sourceMetrics);
      result = {
        ...fallbackData,
        source: 'fallback',
        generatedAt: new Date()
      };
    }

    try {
      // Persist the output in the DB historical snapshot table
      await AIInsightSnapshot.create({
        insightType,
        agentId,
        generatedAt: result.generatedAt,
        summary: result.summary,
        recommendations: result.recommendations,
        confidence: result.confidence,
        reasoning: result.reasoning,
        sourceMetrics,
        source: result.source
      });
    } catch (dbErr) {
      console.error('[AIController] Failed to persist AIInsightSnapshot:', dbErr.message);
    }

    // Cache the result
    cache[cacheKey] = {
      timestamp: Date.now(),
      data: result
    };

    return result;
  })();

  inFlightRequests[cacheKey] = queryPromise;

  try {
    const finalResult = await queryPromise;
    return finalResult;
  } finally {
    delete inFlightRequests[cacheKey];
  }
};

/**
 * Fallback Generator for Team Insights
 */
const generateInsightsFallback = (metrics) => {
  const recommendations = [];

  if (metrics.upcomingSLABreaches > 0) {
    recommendations.push({
      recommendation: `Prioritize queue routing or reassign the ${metrics.upcomingSLABreaches} tasks approaching deadline.`,
      reason: "impending SLA breaches detected in current workload distributions.",
      supportingMetrics: { "Impending Breaches": metrics.upcomingSLABreaches },
      priority: "High"
    });
  }

  if (metrics.criticalRiskCount > 0) {
    recommendations.push({
      recommendation: "Execute workload rebalancing for critical risk agents.",
      reason: `${metrics.criticalRiskCount} agents have crossed critical overload indicators.`,
      supportingMetrics: { "Critical Risk Agents": metrics.criticalRiskCount },
      priority: "High"
    });
  }

  if (metrics.averageCompletionRate < 75) {
    recommendations.push({
      recommendation: "Conduct general review of queue allocation guidelines.",
      reason: `Overall average completion rate (${metrics.averageCompletionRate}%) is currently below target threshold.`,
      supportingMetrics: { "Completion Rate": `${metrics.averageCompletionRate}%` },
      priority: "Medium"
    });
  }

  // Add a general default if empty
  if (recommendations.length === 0) {
    recommendations.push({
      recommendation: "Maintain current distribution schedules.",
      reason: "All operational metrics reflect normal thresholds.",
      supportingMetrics: { "Active Agents": metrics.activeAgents },
      priority: "Low"
    });
  }

  return {
    confidence: 70,
    summary: `Operational indicators summary: Active workload consists of ${metrics.totalTasks} tasks distributed across ${metrics.activeAgents} agents. Average completion rate is ${metrics.averageCompletionRate}% with a team risk score average of ${metrics.averageRiskScore}%.`,
    reasoning: "Rule-based analysis derived from dashboard KPI telemetry. System has evaluated workload, SLA warnings, and individual capacity constraints to trigger alerts.",
    recommendations
  };
};

/**
 * Fallback Generator for Agent Coaching
 */
const generateCoachingFallback = (metrics) => {
  const recommendations = [];

  if (metrics.overdueTasks > 0) {
    recommendations.push({
      recommendation: `Reassign overdue tasks (${metrics.overdueTasks}) to another agent.`,
      reason: "Agent has active tasks that have already breached their SLA deadlines.",
      supportingMetrics: { "Overdue Tasks": metrics.overdueTasks },
      priority: "High"
    });
  }

  if (metrics.slaBreachProbability > 50) {
    recommendations.push({
      recommendation: "Reduce workload in-flow to prevent upcoming SLA breaches.",
      reason: `SLA breach probability is critical at ${metrics.slaBreachProbability}%.`,
      supportingMetrics: { "Breach Probability": `${metrics.slaBreachProbability}%` },
      priority: "High"
    });
  }

  if (metrics.performanceScore < 70) {
    recommendations.push({
      recommendation: "Conduct targeted task execution coaching session.",
      reason: `Performance score (${metrics.performanceScore}) is graded '${metrics.grade}'.`,
      supportingMetrics: { "Grade": metrics.grade, "Performance Score": metrics.performanceScore },
      priority: "Medium"
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      recommendation: "Maintain current workload capacity.",
      reason: "Agent displays strong performance metrics and healthy capacity indices.",
      supportingMetrics: { "Performance Score": metrics.performanceScore },
      priority: "Low"
    });
  }

  return {
    confidence: 65,
    summary: `coaching overview: Agent is graded ${metrics.grade} with an overall performance score of ${metrics.performanceScore}. Active workload sits at ${metrics.activeTasks} tasks with a capacity risk of ${metrics.agentOverloadRisk}%.`,
    reasoning: "Rule-based analysis calculated from agent workload and performance scorecards.",
    recommendations
  };
};

/**
 * Fallback Generator for Executive Summary
 */
const generateExecutiveSummaryFallback = (metrics) => {
  const recommendations = [];

  if (metrics.overloadedCount > 0) {
    recommendations.push({
      recommendation: `Distribute tasks among the ${metrics.overloadedCount} overloaded agents.`,
      reason: "Workload distribution imbalance detected across active agents.",
      supportingMetrics: { "Overloaded Agents": metrics.overloadedCount },
      priority: "High"
    });
  }

  if (metrics.upcomingSLABreaches > 5) {
    recommendations.push({
      recommendation: "Increase operational staffing or extend SLA deadlines.",
      reason: `${metrics.upcomingSLABreaches} impending SLA violations threaten overall contract compliance.`,
      supportingMetrics: { "Upcoming Breaches": metrics.upcomingSLABreaches },
      priority: "High"
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      recommendation: "Review weekly operational reports.",
      reason: "Weekly key performance parameters are within expectations.",
      supportingMetrics: { "SLA Compliance": `${metrics.averageSLACompliance}%` },
      priority: "Low"
    });
  }

  return {
    confidence: 75,
    summary: `Strategic briefing: System tracks ${metrics.totalTasks} active tasks across ${metrics.activeAgents} agents. Overall SLA compliance is running at ${metrics.averageSLACompliance}% with a team average performance score of ${metrics.teamAverageScore}.`,
    reasoning: "Rule-based report aggregation generated for executive level oversight.",
    recommendations
  };
};

/**
 * Helper to retrieve aggregated team statistics.
 */
const getAggregatedTeamMetrics = async (from, to) => {
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});
  
  // Reuse existing analytics logic
  const analyticsData = await fetchAgentAnalyticsDataInternal(from, to);
  const workloads = calculateAgentWorkload(distributions, agents);
  
  let totalRiskScore = 0;
  let criticalRiskCount = 0;
  let upcomingSLABreaches = 0;
  let totalActive = 0;
  let overloadedCount = 0;

  for (const agent of agents) {
    const risk = calculateAgentRiskAsOf(agent._id, distributions, new Date());
    totalRiskScore += risk.riskScore;
    if (risk.riskCategory === 'Critical Risk') {
      criticalRiskCount++;
    }
    upcomingSLABreaches += risk.approachingTasks;
    totalActive += risk.activeTasks;

    const workload = workloads.find(w => w.agentId.toString() === agent._id.toString());
    if (workload && workload.status === 'Overloaded') {
      overloadedCount++;
    }
  }

  const averageRiskScore = agents.length > 0 ? Math.round(totalRiskScore / agents.length) : 0;
  
  // Calculate average SLA Compliance across agents
  let totalSLACompliance = 0;
  let totalPerformance = 0;
  agents.forEach(agent => {
    const perf = calculateAgentPerformanceAsOf(agent._id, distributions, new Date());
    totalSLACompliance += perf.slaComplianceRate;
    totalPerformance += perf.performanceScore;
  });
  
  const averageSLACompliance = agents.length > 0 ? Math.round(totalSLACompliance / agents.length) : 100;
  const teamAverageScore = agents.length > 0 ? Math.round(totalPerformance / agents.length) : 0;

  return {
    activeAgents: agents.length,
    totalTasks: analyticsData.completionMetrics.total,
    completedTasks: analyticsData.completionMetrics.completed,
    pendingTasks: analyticsData.completionMetrics.pending,
    inProgressTasks: analyticsData.completionMetrics.inProgress,
    failedTasks: analyticsData.completionMetrics.failed,
    averageCompletionRate: analyticsData.averageCompletionRate,
    averageRiskScore,
    criticalRiskCount,
    upcomingSLABreaches,
    overloadedCount,
    averageSLACompliance,
    teamAverageScore
  };
};

/**
 * @desc    Get AI Insights (Team Summary & Workloads)
 * @route   GET /api/ai/insights
 * @access  Private (Admin)
 */
const getAIInsights = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const cacheKey = getCacheKey('insights', getDateRangeStr(from, to));

  // Check if cache contains valid data
  const cachedVal = cache[cacheKey];
  if (cachedVal && (Date.now() - cachedVal.timestamp < CACHE_TTL)) {
    return res.status(200).json({
      success: true,
      ...cachedVal.data,
      cachedMinutesAgo: Math.round((Date.now() - cachedVal.timestamp) / 60000)
    });
  }

  // Load and reuse analytics data
  const metrics = await getAggregatedTeamMetrics(from, to);
  const prompt = getInsightsPrompt(metrics);

  const responseData = await executeAIQuery({
    cacheKey,
    insightType: 'insights',
    agentId: null,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    sourceMetrics: metrics,
    fallbackGenerator: generateInsightsFallback
  });

  res.status(200).json({
    success: true,
    ...responseData,
    cachedMinutesAgo: 0
  });
});

/**
 * @desc    Get AI Coaching Review per Agent
 * @route   GET /api/ai/coaching/:agentId
 * @access  Private (Admin)
 */
const getAICoaching = asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const cacheKey = getCacheKey('coaching', 'default', agentId);

  // Check cache
  const cachedVal = cache[cacheKey];
  if (cachedVal && (Date.now() - cachedVal.timestamp < CACHE_TTL)) {
    return res.status(200).json({
      success: true,
      ...cachedVal.data,
      cachedMinutesAgo: Math.round((Date.now() - cachedVal.timestamp) / 60000)
    });
  }

  const agent = await User.findById(agentId);
  if (!agent) {
    return res.status(404).json({ success: false, message: 'Agent not found' });
  }

  const distributions = await Distribution.find({});
  const riskMetrics = calculateAgentRiskAsOf(agent._id, distributions, new Date());
  const performanceMetrics = calculateAgentPerformanceAsOf(agent._id, distributions, new Date());

  const combinedMetrics = {
    ...riskMetrics,
    ...performanceMetrics
  };

  const prompt = getCoachingPrompt(agent.name, combinedMetrics);

  const responseData = await executeAIQuery({
    cacheKey,
    insightType: 'coaching',
    agentId: agent._id,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    sourceMetrics: combinedMetrics,
    fallbackGenerator: generateCoachingFallback
  });

  res.status(200).json({
    success: true,
    ...responseData,
    cachedMinutesAgo: 0
  });
});

/**
 * @desc    Get AI Executive Strategic Summary
 * @route   GET /api/ai/executive-summary
 * @access  Private (Admin)
 */
const getAIExecutiveSummary = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const cacheKey = getCacheKey('exec_summary', getDateRangeStr(from, to));

  // Check cache
  const cachedVal = cache[cacheKey];
  if (cachedVal && (Date.now() - cachedVal.timestamp < CACHE_TTL)) {
    return res.status(200).json({
      success: true,
      ...cachedVal.data,
      cachedMinutesAgo: Math.round((Date.now() - cachedVal.timestamp) / 60000)
    });
  }

  const metrics = await getAggregatedTeamMetrics(from, to);
  const prompt = getExecutiveSummaryPrompt(metrics);

  const responseData = await executeAIQuery({
    cacheKey,
    insightType: 'executive-summary',
    agentId: null,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    sourceMetrics: metrics,
    fallbackGenerator: generateExecutiveSummaryFallback
  });

  res.status(200).json({
    success: true,
    ...responseData,
    cachedMinutesAgo: 0
  });
});

module.exports = {
  getAIInsights,
  getAICoaching,
  getAIExecutiveSummary
};
