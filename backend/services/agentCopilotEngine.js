const User = require('../models/User');
const Distribution = require('../models/Distribution');
const AgentCopilotPreference = require('../models/AgentCopilotPreference');
const AgentCopilotSession = require('../models/AgentCopilotSession');
const AgentCoachingSnapshot = require('../models/AgentCoachingSnapshot');
const AgentAchievement = require('../models/AgentAchievement');
const Achievement = require('../models/Achievement');
const { callGroq } = require('./groqService');
const { logActivity } = require('../utils/activityLogger');
const {
  fetchAgentRecords,
  calculateProductivityScore,
  calculateCompletionMetrics,
  calculateSLAMetrics,
  calculateAgentRanking
} = require('./agentPerformanceEngine');
const {
  SUMMARY_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT
} = require('../prompts/agentCopilotPrompts');

// Cache storage and requests tracking
const cache = {};
const inFlightRequests = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes cache limit

const getCachedData = (key) => {
  const entry = cache[key];
  if (entry && (Date.now() - entry.timestamp < CACHE_TTL)) {
    return entry.data;
  }
  return null;
};

const setCachedData = (key, data) => {
  cache[key] = {
    timestamp: Date.now(),
    data
  };
};

const deduplicate = (key, fetchFn) => {
  if (inFlightRequests[key]) {
    return inFlightRequests[key];
  }
  const promise = fetchFn().finally(() => {
    delete inFlightRequests[key];
  });
  inFlightRequests[key] = promise;
  return promise;
};

/**
 * Trims conversation messages to keep token context size small.
 */
const trimMessagesContext = (messages, maxMessages = 8) => {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(-maxMessages);
};

/**
 * Builds standard metrics context object for the agent.
 */
const getAgentMetricsContext = async (agentId) => {
  const [prod, completion, sla, ranking, user] = await Promise.all([
    calculateProductivityScore(agentId),
    calculateCompletionMetrics(agentId),
    calculateSLAMetrics(agentId),
    calculateAgentRanking(agentId),
    User.findById(agentId)
  ]);

  return {
    score: prod.score,
    grade: prod.grade,
    completed: completion.completed,
    totalAssigned: completion.totalAssigned,
    completionRate: completion.completionRate,
    onTimeCompleted: sla.onTimeCompleted,
    slaCompliance: sla.slaCompliance,
    pending: completion.pending,
    ranking,
    level: user.level || 1,
    points: user.points || 0,
    currentStreak: user.currentStreak || 0,
    longestStreak: user.longestStreak || 0
  };
};

/**
 * Fallback summary generator in case AI fails.
 */
const generateFallbackSummary = (metrics) => {
  const summary = `You have completed ${metrics.completed} out of ${metrics.totalAssigned} assigned tasks. Your current productivity score is ${metrics.score}% with a grade of ${metrics.grade}. Focus on outstanding SLA items.`;
  
  const highlights = [];
  if (metrics.score >= 80) highlights.push(`Productivity score is strong at ${metrics.score}%`);
  if (metrics.slaCompliance >= 90) highlights.push(`SLA compliance is stable at ${metrics.slaCompliance}%`);
  if (highlights.length === 0) highlights.push("Maintained daily console operational status");

  const risks = [];
  if (metrics.slaCompliance < 80) risks.push(`SLA Compliance is below standard (${metrics.slaCompliance}%)`);
  if (metrics.pending > 5) risks.push(`Pending queue backlog of ${metrics.pending} items`);
  if (risks.length === 0) risks.push("No immediate SLA risks detected");

  const focusObjectives = [];
  if (metrics.pending > 0) {
    focusObjectives.push("Prioritize clearing pending tasks in queue");
  }
  focusObjectives.push("Review daily plan schedule and critical items");

  return {
    summary,
    highlights,
    risks,
    focusObjectives
  };
};

/**
 * 1. Generate Daily Summary
 */
const generateDailySummary = async (agentId, io = null) => {
  const cacheKey = `summary:${agentId}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  return deduplicate(cacheKey, async () => {
    const agent = await User.findById(agentId);
    if (!agent) throw new Error('Agent not found');

    const metrics = await getAgentMetricsContext(agentId);
    const coaching = await AgentCoachingSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });
    const preferences = await AgentCopilotPreference.findOne({ agentId }) || {};

    let result;
    try {
      const userPrompt = `Agent: ${agent.name}
Preferences: ${JSON.stringify(preferences)}
Metrics: ${JSON.stringify(metrics)}
Coaching insights: ${coaching ? JSON.stringify({ strengths: coaching.strengths, weaknesses: coaching.weaknesses }) : "None"}`;

      const aiResponse = await callGroq(SUMMARY_SYSTEM_PROMPT, userPrompt);
      if (aiResponse && aiResponse.summary) {
        result = {
          ...aiResponse,
          source: 'ai'
        };
      } else {
        throw new Error('Malformed AI response');
      }
    } catch (err) {
      console.warn(`[CopilotEngine] Daily Summary AI failed, using fallback: ${err.message}`);
      const fallback = generateFallbackSummary(metrics);
      result = {
        ...fallback,
        source: 'fallback'
      };
    }

    setCachedData(cacheKey, result);

    // Audit and Activity Logging
    await logActivity({
      actionType: 'COPILOT_SUMMARY_GENERATED',
      entityType: 'User',
      entityId: agentId,
      userId: agentId,
      metadata: { source: result.source }
    }, io);

    return result;
  });
};

/**
 * 2. Smart Work Planner & Priorities
 */
const generateSmartPlanner = async (agentId, io = null) => {
  const cacheKey = `planner:${agentId}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  return deduplicate(cacheKey, async () => {
    const agent = await User.findById(agentId);
    if (!agent) throw new Error('Agent not found');

    const records = await fetchAgentRecords(agentId);
    const metrics = await getAgentMetricsContext(agentId);
    const coaching = await AgentCoachingSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });
    const preferences = await AgentCopilotPreference.findOne({ agentId }) || {};

    // Grouping tasks by urgency
    const activeTasks = records.filter(r => r.status === 'pending' || r.status === 'in-progress');
    const overdue = activeTasks.filter(r => r.slaStatus === 'overdue');
    const dueToday = activeTasks.filter(r => {
      if (!r.dueDate) return false;
      const today = new Date().toDateString();
      return new Date(r.dueDate).toDateString() === today && r.slaStatus !== 'overdue';
    });
    const highRisk = activeTasks.filter(r => r.priority === 'critical' && r.slaStatus !== 'overdue');

    let result;
    try {
      const simplifiedTasks = activeTasks.map(t => ({
        id: t._id,
        name: `${t.firstName} ${t.lastName || ''}`,
        priority: t.priority,
        slaStatus: t.slaStatus,
        dueDate: t.dueDate
      }));

      const userPrompt = `Agent: ${agent.name}
Active Tasks: ${JSON.stringify(simplifiedTasks.slice(0, 15))}
Preferences: ${JSON.stringify(preferences)}
Coaching insights: ${coaching ? JSON.stringify({ weaknesses: coaching.weaknesses }) : "None"}`;

      const aiResponse = await callGroq(PLANNER_SYSTEM_PROMPT, userPrompt);
      if (aiResponse && Array.isArray(aiResponse.recommendedExecutionOrder)) {
        result = {
          ...aiResponse,
          overdue,
          dueToday,
          highRisk,
          source: 'ai'
        };
      } else {
        throw new Error('Malformed AI response');
      }
    } catch (err) {
      console.warn(`[CopilotEngine] Planner AI failed, using fallback: ${err.message}`);
      
      // Fallback recommended order based on risk-based rules
      const recommendedExecutionOrder = [];
      overdue.forEach(t => recommendedExecutionOrder.push({ taskId: t._id, taskName: `${t.firstName} ${t.lastName || ''}`, reason: 'Task is overdue' }));
      highRisk.forEach(t => recommendedExecutionOrder.push({ taskId: t._id, taskName: `${t.firstName} ${t.lastName || ''}`, reason: 'Task is marked critical priority' }));
      dueToday.forEach(t => recommendedExecutionOrder.push({ taskId: t._id, taskName: `${t.firstName} ${t.lastName || ''}`, reason: 'Task is due today' }));
      
      if (recommendedExecutionOrder.length === 0) {
        recommendedExecutionOrder.push({ taskId: 'none', taskName: 'All clear!', reason: 'No outstanding active tasks found' });
      }

      result = {
        recommendedExecutionOrder,
        slaRescueAdvice: 'Address overdue items first, then proceed with critical items.',
        productivitySuggestions: [
          'Review SLA limits daily to structure your tasks.',
          'Consistently clear critical items before standard assignments.'
        ],
        overdue,
        dueToday,
        highRisk,
        source: 'fallback'
      };
    }

    setCachedData(cacheKey, result);

    await logActivity({
      actionType: 'COPILOT_RECOMMENDATION_USED',
      entityType: 'User',
      entityId: agentId,
      userId: agentId,
      metadata: { source: result.source }
    }, io);

    return result;
  });
};

/**
 * 3. AI Copilot Chat assistant
 */
const executeCopilotChat = async (agentId, sessionId, userMessage, io = null) => {
  const agent = await User.findById(agentId);
  if (!agent) throw new Error('Agent not found');

  let session;
  if (sessionId) {
    session = await AgentCopilotSession.findById(sessionId);
  }

  if (!session) {
    session = await AgentCopilotSession.create({
      agentId,
      title: userMessage.substring(0, 30) + (userMessage.length > 30 ? '...' : ''),
      messages: []
    });
  }

  // Save user message
  session.messages.push({
    role: 'user',
    content: userMessage,
    timestamp: new Date()
  });

  const preferences = await AgentCopilotPreference.findOne({ agentId }) || {};
  const metrics = await getAgentMetricsContext(agentId);
  const coaching = await AgentCoachingSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });

  // Get trimmed history
  const trimmed = trimMessagesContext(session.messages);

  let assistantContent = '';
  try {
    const userPrompt = `Agent: ${agent.name}
Preferences: ${JSON.stringify(preferences)}
Metrics: ${JSON.stringify(metrics)}
Coaching insights: ${coaching ? JSON.stringify({ strengths: coaching.strengths, weaknesses: coaching.weaknesses }) : "None"}
Conversation History: ${JSON.stringify(trimmed)}
New user message: ${userMessage}`;

    const response = await callGroq(CHAT_SYSTEM_PROMPT, userPrompt);
    if (response && response.message) {
      assistantContent = response.message;
    } else {
      throw new Error('Empty message content in JSON');
    }
  } catch (err) {
    console.error('[CopilotEngine] Chat assistant AI failed:', err.message);
    assistantContent = `I am currently operating in offline mode. Let me suggest next steps: based on your queue, you have ${metrics.pending} pending tasks. Try addressing any critical or overdue items first, and let me know if you need specific template scripts.`;
  }

  session.messages.push({
    role: 'assistant',
    content: assistantContent,
    timestamp: new Date()
  });

  await session.save();

  await logActivity({
    actionType: 'COPILOT_CHAT_CREATED',
    entityType: 'User',
    entityId: agentId,
    userId: agentId,
    metadata: { sessionId: session._id }
  }, io);

  return session;
};

/**
 * 4. Generate AI Communication Templates
 */
const generateAICommunicationFollowup = async (agentId, recordId, io = null) => {
  const cacheKey = `followup:${recordId}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  return deduplicate(cacheKey, async () => {
    // Find record within distributions
    const distributions = await Distribution.find({ 'agents.records._id': recordId });
    if (distributions.length === 0) throw new Error('Task record not found');

    const dist = distributions[0];
    const agentData = dist.agents.find(a => a.agentId.toString() === agentId.toString());
    if (!agentData) throw new Error('Unauthorized or not assigned to agent');

    const record = agentData.records.id(recordId);
    if (!record) throw new Error('Task record details missing');

    const agent = await User.findById(agentId);

    let result;
    try {
      const userPrompt = `Agent Name: ${agent.name}
Customer Name: ${record.firstName} ${record.lastName || ''}
Phone: ${record.phone || 'N/A'}
Notes: ${record.notes || 'N/A'}
Priority: ${record.priority || 'standard'}
SLA Status: ${record.slaStatus || 'on_track'}
Due Date: ${record.dueDate || 'N/A'}`;

      const aiResponse = await callGroq(FOLLOWUP_SYSTEM_PROMPT, userPrompt);
      if (aiResponse && aiResponse.callFollowup) {
        result = {
          ...aiResponse,
          source: 'ai'
        };
      } else {
        throw new Error('Malformed follow-up response');
      }
    } catch (err) {
      console.warn(`[CopilotEngine] Followup AI failed, using fallback templates: ${err.message}`);
      
      const customerName = `${record.firstName} ${record.lastName || ''}`;
      result = {
        callFollowup: {
          script: `Hi ${customerName}, I'm calling from the distributions team regarding your account file. I noticed some details need verification. Do you have a few minutes?`,
          objective: 'Verify customer file details and next step actions.'
        },
        emailFollowup: {
          subject: `Follow-up regarding your verification file - Distributions Team`,
          body: `Dear ${customerName},\n\nThis is a quick message to let you know that we are processing your file and need to verify some quick details. Please let us know when you are available.\n\nBest regards,\n${agent.name}`
        },
        whatsappFollowup: {
          message: `Hi ${customerName}, this is ${agent.name} from the distributions team. Just wanted to follow up regarding your verification file. Let me know when you are free to chat.`
        },
        meetingReminder: {
          agenda: 'Review distribution details and finalize registration.',
          inviteNote: `Hi ${customerName}, let's schedule a brief meeting to verify your documentation.`
        },
        escalationFollowup: {
          subject: `URGENT: Outstanding verification details required`,
          body: `Dear ${customerName},\n\nWe need to urgently complete verification for your file. Please contact us at your earliest convenience to prevent account holds.\n\nBest regards,\n${agent.name}`
        },
        source: 'fallback'
      };
    }

    setCachedData(cacheKey, result);

    await logActivity({
      actionType: 'COPILOT_FOLLOWUP_GENERATED',
      entityType: 'Record',
      entityId: recordId,
      userId: agentId,
      metadata: { recordId, source: result.source }
    }, io);

    return result;
  });
};

module.exports = {
  generateDailySummary,
  generateSmartPlanner,
  executeCopilotChat,
  generateAICommunicationFollowup
};
