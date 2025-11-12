const cron = require('node-cron');
const User = require('../models/User');
const Distribution = require('../models/Distribution');
const Report = require('../models/Report');
const AIInsightSnapshot = require('../models/AIInsightSnapshot');
const AutomationRule = require('../models/AutomationRule');
const AutomationExecution = require('../models/AutomationExecution');
const { calculateAgentWorkload } = require('../utils/workloadCalculator');
const { calculateAgentRiskAsOf } = require('../utils/riskCalculator');
const { calculateAgentPerformanceAsOf } = require('../utils/performanceCalculator');
const { generateReportData } = require('../utils/reportGenerator');
const { logActivity } = require('../utils/activityLogger');
const { callGroq } = require('./groqService');
const { getInsightsPrompt } = require('../prompts/operationsPrompts');

/**
 * Calculates next execution date based on trigger type.
 */
const calculateNextRun = (triggerType) => {
  const now = new Date();
  if (triggerType === 'WEEKLY_REPORT') {
    // Friday at 18:00 (6 PM)
    const nextFriday = new Date(now);
    const day = now.getDay();
    const diff = (day <= 5 ? 5 - day : 12 - day); // days to next Friday
    nextFriday.setDate(now.getDate() + diff);
    nextFriday.setHours(18, 0, 0, 0);
    if (nextFriday <= now) {
      nextFriday.setDate(nextFriday.getDate() + 7);
    }
    return nextFriday;
  } else if (triggerType === 'MONTHLY_REPORT') {
    // 1st of next month at 09:00 AM
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0, 0);
    return nextMonth;
  }
  return null; // Event-driven rules don't have standard future schedules
};

/**
 * Helper to fetch aggregated team metrics for AI Actions
 */
const getTeamMetricsForAI = async () => {
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});
  
  let totalRisk = 0;
  let criticalRiskCount = 0;
  let upcomingSLABreaches = 0;
  let totalTasks = 0;
  let completedTasks = 0;
  let pendingTasks = 0;
  let inProgressTasks = 0;
  let failedTasks = 0;

  distributions.forEach(dist => {
    dist.agents?.forEach(a => {
      a.records?.forEach(r => {
        totalTasks++;
        if (r.status === 'completed') completedTasks++;
        else if (r.status === 'pending') pendingTasks++;
        else if (r.status === 'in-progress') inProgressTasks++;
        else if (r.status === 'failed') failedTasks++;
      });
    });
  });

  for (const agent of agents) {
    const risk = calculateAgentRiskAsOf(agent._id, distributions, new Date());
    totalRisk += risk.riskScore;
    if (risk.riskCategory === 'Critical Risk') {
      criticalRiskCount++;
    }
    upcomingSLABreaches += risk.approachingTasks;
  }

  const averageRiskScore = agents.length > 0 ? Math.round(totalRisk / agents.length) : 0;
  const averageCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    activeAgents: agents.length,
    totalTasks,
    completedTasks,
    pendingTasks,
    inProgressTasks,
    failedTasks,
    averageCompletionRate,
    averageRiskScore,
    criticalRiskCount,
    upcomingSLABreaches
  };
};

/**
 * Evaluates a specific rule condition against active system metrics.
 */
const evaluateCondition = async (rule, distributions, agents) => {
  const cond = rule.condition;
  if (!cond) return { isMatched: true, matchedEntities: [] };

  if (rule.triggerType === 'OVERDUE_TASKS') {
    const workloads = calculateAgentWorkload(distributions, agents);
    const totalOverdue = workloads.reduce((sum, w) => sum + w.overdueTasks, 0);
    
    let isMatched = false;
    if (cond.operator === '>') isMatched = totalOverdue > cond.value;
    else if (cond.operator === '<') isMatched = totalOverdue < cond.value;
    else isMatched = totalOverdue == cond.value;

    return {
      isMatched,
      matchedEntities: isMatched ? [{ name: 'System', overdueCount: totalOverdue }] : []
    };
  }

  if (rule.triggerType === 'SLA_RISK') {
    const matchedAgents = [];
    for (const agent of agents) {
      const risk = calculateAgentRiskAsOf(agent._id, distributions, new Date());
      if (typeof cond.value === 'string') {
        if (risk.riskCategory === cond.value) {
          matchedAgents.push({ name: agent.name, riskCategory: risk.riskCategory, riskScore: risk.riskScore });
        }
      } else {
        // Assume number threshold comparison
        let match = false;
        if (cond.operator === '>') match = risk.riskScore > cond.value;
        else if (cond.operator === '<') match = risk.riskScore < cond.value;
        else match = risk.riskScore == cond.value;

        if (match) {
          matchedAgents.push({ name: agent.name, riskScore: risk.riskScore });
        }
      }
    }
    return {
      isMatched: matchedAgents.length > 0,
      matchedEntities: matchedAgents
    };
  }

  if (rule.triggerType === 'WORKLOAD_THRESHOLD') {
    const workloads = calculateAgentWorkload(distributions, agents);
    const matchedAgents = [];

    workloads.forEach(w => {
      let match = false;
      if (cond.operator === '>') match = w.activeTasks > cond.value;
      else if (cond.operator === '<') match = w.activeTasks < cond.value;
      else match = w.activeTasks == cond.value;

      if (match) {
        matchedAgents.push({ name: w.name, activeTasks: w.activeTasks });
      }
    });

    return {
      isMatched: matchedAgents.length > 0,
      matchedEntities: matchedAgents
    };
  }

  // Time schedules match by default once time is evaluated
  return { isMatched: true, matchedEntities: [] };
};

/**
 * Executes the configured action of a rule.
 */
const executeAction = async (rule, matchedEntities, io) => {
  const { type, params } = rule.action;

  if (type === 'GENERATE_AI_SUMMARY') {
    const metrics = await getTeamMetricsForAI();
    const prompt = getInsightsPrompt(metrics);

    // Call Groq AI service
    const groqResponse = await callGroq(prompt.system, prompt.user);

    // Store in AIInsightSnapshot
    const snapshot = await AIInsightSnapshot.create({
      insightType: 'insights',
      generatedAt: new Date(),
      summary: groqResponse.summary,
      recommendations: groqResponse.recommendations,
      confidence: groqResponse.confidence,
      reasoning: groqResponse.reasoning,
      sourceMetrics: metrics,
      source: 'ai'
    });

    // Log Activity event
    await logActivity({
      actionType: 'AUTOMATION_EXECUTED',
      entityType: 'Report',
      entityId: snapshot._id,
      userId: rule.createdBy,
      metadata: { ruleName: rule.name, actionType: type, snapshotId: snapshot._id }
    }, io);

    return { success: true, snapshotId: snapshot._id };
  }

  if (type === 'CREATE_ALERT') {
    // Generate alert details for matched entities
    const details = matchedEntities.map(e => `${e.name} (Value: ${e.activeTasks || e.riskScore || e.overdueCount})`).join(', ');
    const alertMessage = `${params?.message || 'Automation Alert Triggered'}: ${details}`;

    // Log Activity event (which behaves as a dashboard alert/notification)
    const log = await logActivity({
      actionType: 'AUTOMATION_EXECUTED',
      entityType: 'User',
      entityId: rule.createdBy,
      userId: rule.createdBy,
      metadata: { ruleName: rule.name, actionType: type, message: alertMessage }
    }, io);

    return { success: true, alertMessage, logId: log?._id };
  }

  if (type === 'GENERATE_REPORT') {
    const reportType = params?.reportType || 'analytics';
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const reportData = await generateReportData({
      from: oneWeekAgo.toISOString(),
      to: now.toISOString(),
      type: reportType
    });

    const report = await Report.create({
      reportType,
      generatedAt: now,
      dateRange: {
        from: oneWeekAgo,
        to: now
      },
      generatedBy: rule.createdBy,
      data: reportData
    });

    // Log Activity events
    await logActivity({
      actionType: 'REPORT_GENERATED_AUTOMATICALLY',
      entityType: 'Report',
      entityId: report._id,
      userId: rule.createdBy,
      metadata: { ruleName: rule.name, reportType }
    }, io);

    return { success: true, reportId: report._id, reportType };
  }

  throw new Error(`Unsupported action type: ${type}`);
};

/**
 * Main evaluation loop triggered periodically.
 */
const evaluateRules = async (io = null) => {
  console.log('🤖 [AutomationEngine] Starting rule evaluation cycle...');
  try {
    const rules = await AutomationRule.find({ isEnabled: true });
    if (rules.length === 0) return;

    const distributions = await Distribution.find({});
    const agents = await User.find({ role: 'agent', isActive: true });
    const now = new Date();

    for (const rule of rules) {
      let isTimeDue = true;

      // Handle time-scheduled triggers specifically
      if (rule.triggerType === 'WEEKLY_REPORT' || rule.triggerType === 'MONTHLY_REPORT') {
        const isFridayPM = now.getDay() === 5 && now.getHours() === 18;
        const isMonthlyAM = now.getDate() === 1 && now.getHours() === 9;
        
        const matchesSchedule = (rule.triggerType === 'WEEKLY_REPORT' && isFridayPM) || 
                                (rule.triggerType === 'MONTHLY_REPORT' && isMonthlyAM);

        const hasAlreadyRunToday = rule.lastRun && new Date(rule.lastRun).toDateString() === now.toDateString();

        isTimeDue = matchesSchedule && !hasAlreadyRunToday;
      }

      if (!isTimeDue) continue;

      // Evaluate Condition
      const { isMatched, matchedEntities } = await evaluateCondition(rule, distributions, agents);

      if (isMatched) {
        console.log(`⚡ [AutomationEngine] Rule matched: '${rule.name}'. Running action...`);
        const startTime = Date.now();
        rule.status = 'Running';
        await rule.save();

        try {
          const actionResult = await executeAction(rule, matchedEntities, io);
          const duration = Date.now() - startTime;

          // Record successful execution
          await AutomationExecution.create({
            ruleId: rule._id,
            executedAt: new Date(),
            executionStatus: 'Success',
            executionDuration: duration,
            actionType: rule.action.type,
            executionResult: actionResult
          });

          rule.lastRun = new Date();
          rule.nextRun = calculateNextRun(rule.triggerType);
          rule.status = 'Executed';
          await rule.save();

          console.log(`✅ [AutomationEngine] Rule '${rule.name}' executed successfully in ${duration}ms`);
        } catch (err) {
          const duration = Date.now() - startTime;
          console.error(`❌ [AutomationEngine] Rule '${rule.name}' failed:`, err.message);

          // Record failed execution
          await AutomationExecution.create({
            ruleId: rule._id,
            executedAt: new Date(),
            executionStatus: 'Failure',
            executionDuration: duration,
            actionType: rule.action.type,
            errorMessage: err.message
          });

          rule.lastRun = new Date();
          rule.status = 'Error';
          await rule.save();
        }
      }
    }
  } catch (err) {
    console.error('🚨 [AutomationEngine] Error inside evaluation cycle:', err.message);
  }
};

/**
 * Simulates a rule config against current DB state without committing side-effects.
 */
const simulateRule = async (ruleConfig) => {
  const distributions = await Distribution.find({});
  const agents = await User.find({ role: 'agent', isActive: true });

  // Mock standard AutomationRule object to evaluate condition
  const mockRule = {
    triggerType: ruleConfig.triggerType,
    condition: ruleConfig.condition,
    action: ruleConfig.action
  };

  const { isMatched, matchedEntities } = await evaluateCondition(mockRule, distributions, agents);

  const expectedActions = [];
  let estimatedImpact = 'Low';

  if (isMatched) {
    const type = ruleConfig.action.type;
    if (type === 'GENERATE_AI_SUMMARY') {
      expectedActions.push('Collect system-wide operational KPIs and call Groq AI to generate executive snapshots.');
      estimatedImpact = 'Medium';
    } else if (type === 'CREATE_ALERT') {
      matchedEntities.forEach(e => {
        expectedActions.push(`Generate dashboard warning notification for Agent '${e.name}'.`);
      });
      estimatedImpact = matchedEntities.length > 3 ? 'High' : 'Medium';
    } else if (type === 'GENERATE_REPORT') {
      expectedActions.push(`Compile weekly report and save report snapshot (Type: ${ruleConfig.action.params?.reportType || 'analytics'}).`);
      estimatedImpact = 'Low';
    }
  } else {
    expectedActions.push('No action triggered (Condition threshold not met).');
  }

  return {
    matchedEntities,
    expectedActions,
    estimatedImpact
  };
};

/**
 * Starts the engine scheduler.
 */
const initializeAutomationEngine = (io = null) => {
  console.log('🔌 [AutomationEngine] Initializing Periodic Scheduler (1-minute cycles)...');
  
  // Rule checker scheduled every minute
  cron.schedule('* * * * *', () => {
    evaluateRules(io);
  });
};

module.exports = {
  initializeAutomationEngine,
  evaluateRules,
  simulateRule,
  calculateNextRun
};
