const { asyncHandler } = require('../middleware/errorHandler');
const User = require('../models/User');
const Distribution = require('../models/Distribution');
const Incident = require('../models/Incident');
const WarRoomNote = require('../models/WarRoomNote');
const SystemHealthSnapshot = require('../models/SystemHealthSnapshot');
const AIInsightSnapshot = require('../models/AIInsightSnapshot');
const AutomationRule = require('../models/AutomationRule');
const AutomationExecution = require('../models/AutomationExecution');
const ActivityLog = require('../models/ActivityLog');

const {
  calculateLiveMetrics,
  calculateSystemHealth,
  correlateAlertsAndGenerateIncidents,
  calculateMTTR,
  getLatestLiveMetrics,
  getLatestSystemHealth
} = require('../services/liveMetricsEngine');
const { calculateAgentRiskAsOf } = require('../utils/riskCalculator');

/**
 * Calculates percentage changes for health trend stats.
 */
const calculateTrendChange = (curr, prev) => {
  if (!prev) return 0;
  return Math.round(((curr - prev) / prev) * 100 * 10) / 10;
};

/**
 * @desc    Get consolidated Operations War Room overview
 * @route   GET /api/command-center/overview
 * @access  Private (Admin)
 */
const getWarRoomOverview = asyncHandler(async (req, res) => {
  // 1. Calculate latest metrics on the fly to ensure freshness
  const liveMetrics = await calculateLiveMetrics();
  const currentHealth = await calculateSystemHealth();

  // 2. Fetch rolling system health snapshots for trend charts (last 24 hours)
  const healthSnapshots = await SystemHealthSnapshot.find({})
    .sort({ generatedAt: -1 })
    .limit(24);
  
  // Reverse to make it chronological
  const snapshotsChronological = [...healthSnapshots].reverse();

  // Compute percentage changes comparing the latest snapshot to the one from 24 hours ago
  const latestSnap = currentHealth;
  const oldestSnap = snapshotsChronological[0] || currentHealth;

  const trendChanges = {
    apiResponseTime: calculateTrendChange(latestSnap.apiResponseTime, oldestSnap.apiResponseTime),
    activeUsers: calculateTrendChange(latestSnap.activeUsers, oldestSnap.activeUsers),
    taskThroughput: calculateTrendChange(latestSnap.taskThroughput, oldestSnap.taskThroughput),
    automationHealth: calculateTrendChange(latestSnap.automationHealth, oldestSnap.automationHealth),
    aiServiceHealth: calculateTrendChange(latestSnap.aiServiceHealth, oldestSnap.aiServiceHealth)
  };

  // 3. Gather active risks (agent-specific risk metadata)
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});
  const activeRisks = [];
  for (const agent of agents) {
    const risk = calculateAgentRiskAsOf(agent._id, distributions, new Date());
    activeRisks.push({
      agentId: agent._id,
      name: agent.name,
      department: agent.department || 'General Operations',
      team: agent.team || 'Default Team',
      metrics: risk
    });
  }

  // 4. Alert Correlation Engine - compile grouped alert cards
  const correlatedAlerts = await correlateAlertsAndGenerateIncidents();

  // 5. Query recent activities
  const recentActivities = await ActivityLog.find({})
    .sort({ createdAt: -1 })
    .limit(15)
    .populate('performedBy', 'name email role');

  res.status(200).json({
    success: true,
    data: {
      liveMetrics,
      systemHealth: {
        current: latestSnap,
        history: snapshotsChronological,
        trendChanges
      },
      activeRisks,
      activeAlerts: correlatedAlerts,
      recentActivities
    }
  });
});

/**
 * @desc    Get all active/resolved incidents and analytics
 * @route   GET /api/command-center/incidents
 * @access  Private (Admin)
 */
const getIncidents = asyncHandler(async (req, res) => {
  const incidents = await Incident.find({})
    .sort({ createdAt: -1 })
    .populate('owner', 'name email role');

  const openIncidents = await Incident.countDocuments({ status: { $ne: 'resolved' } });
  const resolvedIncidents = await Incident.countDocuments({ status: 'resolved' });
  const mttr = await calculateMTTR();

  // Severity Breakdown
  const lowCount = await Incident.countDocuments({ severity: 'low' });
  const mediumCount = await Incident.countDocuments({ severity: 'medium' });
  const highCount = await Incident.countDocuments({ severity: 'high' });
  const criticalCount = await Incident.countDocuments({ severity: 'critical' });

  res.status(200).json({
    success: true,
    data: {
      incidents,
      stats: {
        openIncidents,
        resolvedIncidents,
        mttr,
        severityBreakdown: {
          low: lowCount,
          medium: mediumCount,
          high: highCount,
          critical: criticalCount
        }
      }
    }
  });
});

/**
 * @desc    Update incident status (Acknowledge / Resolve)
 * @route   PATCH /api/command-center/incidents/:id
 * @access  Private (Admin)
 */
const updateIncidentStatus = asyncHandler(async (req, res) => {
  const { status, ownerId } = req.body;
  const incident = await Incident.findById(req.params.id);

  if (!incident) {
    res.status(404);
    throw new Error('Incident not found');
  }

  if (status) {
    incident.status = status;
    if (status === 'resolved') {
      incident.resolvedAt = new Date();
    } else {
      incident.resolvedAt = null;
    }
  }

  if (ownerId !== undefined) {
    incident.owner = ownerId || null;
  }

  await incident.save();

  // Populate owner details
  const populated = await Incident.findById(incident._id).populate('owner', 'name email role');

  // Broadcast incident update via socket
  const io = req.app.get('io');
  if (io) {
    io.emit('incidentUpdated', populated);
  }

  res.status(200).json({
    success: true,
    data: populated
  });
});

/**
 * @desc    Get all war room collaboration notes
 * @route   GET /api/command-center/notes
 * @access  Private (Admin)
 */
const getNotes = asyncHandler(async (req, res) => {
  const notes = await WarRoomNote.find({})
    .sort({ isPinned: -1, createdAt: -1 })
    .populate('author', 'name email role');

  res.status(200).json({
    success: true,
    data: notes
  });
});

/**
 * @desc    Create new war room collaboration note
 * @route   POST /api/command-center/notes
 * @access  Private (Admin)
 */
const createNote = asyncHandler(async (req, res) => {
  const { message, incidentId } = req.body;

  if (!message) {
    res.status(400);
    throw new Error('Note message content is required');
  }

  const note = await WarRoomNote.create({
    message,
    author: req.user._id,
    incidentId: incidentId || null
  });

  const populated = await WarRoomNote.findById(note._id).populate('author', 'name email role');

  // Broadcast note creation via socket
  const io = req.app.get('io');
  if (io) {
    io.emit('noteAdded', populated);
  }

  res.status(201).json({
    success: true,
    data: populated
  });
});

/**
 * @desc    Toggle note pin status
 * @route   PATCH /api/command-center/notes/:id/pin
 * @access  Private (Admin)
 */
const togglePinNote = asyncHandler(async (req, res) => {
  const note = await WarRoomNote.findById(req.params.id);

  if (!note) {
    res.status(404);
    throw new Error('Note not found');
  }

  note.isPinned = !note.isPinned;
  await note.save();

  const populated = await WarRoomNote.findById(note._id).populate('author', 'name email role');

  // Broadcast note update via socket
  const io = req.app.get('io');
  if (io) {
    io.emit('noteUpdated', populated);
  }

  res.status(200).json({
    success: true,
    data: populated
  });
});

/**
 * @desc    Get dynamic sorted Action Center recommendations
 * @route   GET /api/command-center/actions
 * @access  Private (Admin)
 */
const getWarRoomActions = asyncHandler(async (req, res) => {
  const actions = [];
  const agents = await User.find({ role: 'agent', isActive: true });
  const distributions = await Distribution.find({});
  const now = new Date();

  // 1. Workload Analytics
  const overloadedAgents = [];
  for (const agent of agents) {
    const risk = calculateAgentRiskAsOf(agent._id, distributions, now);
    if (risk.activeTasks > 15) {
      overloadedAgents.push({ name: agent.name, count: risk.activeTasks });
    }
  }
  if (overloadedAgents.length > 0) {
    actions.push({
      priority: 'Critical',
      action: `Reassign critical tasks from ${overloadedAgents.length} overloaded agents.`,
      supportingMetric: `${overloadedAgents.map(a => `${a.name} (${a.count})`).join(', ')}`,
      source: 'Workload Analytics'
    });
  }

  // 2. Risk Engine - high breach probability
  let highRiskCount = 0;
  for (const agent of agents) {
    const risk = calculateAgentRiskAsOf(agent._id, distributions, now);
    if (risk.riskCategory === 'Critical Risk' || risk.riskCategory === 'High Risk') {
      highRiskCount++;
    }
  }
  if (highRiskCount > 0) {
    actions.push({
      priority: 'High',
      action: `Conduct capacity audit and balance queue depths for ${highRiskCount} high-risk agents.`,
      supportingMetric: `${highRiskCount} agents displaying elevated breach probability`,
      source: 'Predictive Risk Engine'
    });
  }

  // 3. Automation Engine - failures
  const startOfDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const failedExecutions = await AutomationExecution.find({
    executionStatus: 'Failure',
    executedAt: { $gte: startOfDay }
  }).populate('ruleId');

  if (failedExecutions.length > 0) {
    actions.push({
      priority: 'High',
      action: `Investigate ${failedExecutions.length} failed automation rule runs in Automation Center.`,
      supportingMetric: `${failedExecutions.length} rule execution errors logged today`,
      source: 'Automation Engine'
    });
  }

  // 4. AI Assistant latest recommendation
  const latestAIInsight = await AIInsightSnapshot.findOne({
    insightType: 'insights'
  }).sort({ generatedAt: -1 });

  if (latestAIInsight && latestAIInsight.recommendations?.length > 0) {
    latestAIInsight.recommendations.forEach(rec => {
      actions.push({
        priority: rec.priority || 'Medium',
        action: rec.recommendation,
        supportingMetric: `AI Confidence Score: ${latestAIInsight.confidence}%`,
        source: 'AI Operations Assistant'
      });
    });
  }

  // Fallbacks
  if (actions.length === 0) {
    actions.push({
      priority: 'Low',
      action: 'Conduct routine check on SLA queues and workload distributions.',
      supportingMetric: 'All metrics healthy and online',
      source: 'Standard Operating Procedures'
    });
  }

  // Sort by priority ranking: Critical -> High -> Medium -> Low
  const rank = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
  actions.sort((a, b) => rank[b.priority] - rank[a.priority]);

  res.status(200).json({
    success: true,
    data: actions
  });
});

module.exports = {
  getWarRoomOverview,
  getIncidents,
  updateIncidentStatus,
  getNotes,
  createNote,
  togglePinNote,
  getWarRoomActions
};
