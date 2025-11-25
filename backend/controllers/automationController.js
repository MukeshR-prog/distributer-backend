const AutomationRule = require('../models/AutomationRule');
const SecurityEvent = require('../models/SecurityEvent');
const AutomationExecution = require('../models/AutomationExecution');
const { simulateRule, calculateNextRun } = require('../services/automationEngine');
const { logAudit } = require('../utils/auditLogger');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * @desc    Get all automation rules
 * @route   GET /api/automation
 * @access  Private (Admin)
 */
const getRules = asyncHandler(async (req, res) => {
  const rules = await AutomationRule.find({}).sort({ createdAt: -1 });
  res.status(200).json({
    success: true,
    rules
  });
});

/**
 * @desc    Create new automation rule
 * @route   POST /api/automation
 * @access  Private (Admin)
 */
const createRule = asyncHandler(async (req, res) => {
  const { name, triggerType, condition, action } = req.body;

  const nextRun = calculateNextRun(triggerType);

  const rule = await AutomationRule.create({
    name,
    triggerType,
    condition,
    action,
    nextRun,
    createdBy: req.user._id,
    status: 'Active'
  });

  // Log Audit Action
  await logAudit({
    actionType: 'AUTOMATION_RULE_CREATED',
    entityType: 'AutomationRule',
    entityId: rule._id,
    newState: rule.toJSON(),
    userId: req.user._id
  });

  // Log Security Event
  await SecurityEvent.create({
    eventType: 'Automation Changes',
    userId: req.user._id,
    severity: 'low',
    metadata: {
      action: 'Created automation rule',
      ruleId: rule._id,
      ruleName: rule.name
    }
  });

  res.status(201).json({
    success: true,
    rule
  });
});

/**
 * @desc    Update automation rule
 * @route   PUT /api/automation/:id
 * @access  Private (Admin)
 */
const updateRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, triggerType, condition, action, isEnabled } = req.body;

  const rule = await AutomationRule.findById(id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Rule not found' });
  }

  const previousState = rule.toJSON();

  // Update properties
  if (name !== undefined) rule.name = name;
  if (triggerType !== undefined) {
    rule.triggerType = triggerType;
    rule.nextRun = calculateNextRun(triggerType);
  }
  if (condition !== undefined) rule.condition = condition;
  if (action !== undefined) rule.action = action;
  if (isEnabled !== undefined) {
    rule.isEnabled = isEnabled;
    rule.status = isEnabled ? 'Active' : 'Paused';
  }

  await rule.save();

  // Log Audit Action
  await logAudit({
    actionType: 'AUTOMATION_RULE_UPDATED',
    entityType: 'AutomationRule',
    entityId: rule._id,
    previousState,
    newState: rule.toJSON(),
    userId: req.user._id
  });

  // Log Security Event
  await SecurityEvent.create({
    eventType: 'Automation Changes',
    userId: req.user._id,
    severity: 'low',
    metadata: {
      action: 'Updated automation rule',
      ruleId: rule._id,
      ruleName: rule.name,
      changes: req.body
    }
  });

  res.status(200).json({
    success: true,
    rule
  });
});

/**
 * @desc    Delete automation rule
 * @route   DELETE /api/automation/:id
 * @access  Private (Admin)
 */
const deleteRule = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const rule = await AutomationRule.findById(id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Rule not found' });
  }

  await AutomationRule.findByIdAndDelete(id);

  // Log Audit Action
  await logAudit({
    actionType: 'AUTOMATION_RULE_DELETED',
    entityType: 'AutomationRule',
    entityId: id,
    previousState: rule.toJSON(),
    userId: req.user._id
  });

  // Log Security Event
  await SecurityEvent.create({
    eventType: 'Automation Changes',
    userId: req.user._id,
    severity: 'medium',
    metadata: {
      action: 'Deleted automation rule',
      ruleId: id,
      ruleName: rule.name
    }
  });

  res.status(200).json({
    success: true,
    message: 'Rule deleted successfully'
  });
});

/**
 * @desc    Simulate/test a rule condition against active metrics
 * @route   POST /api/automation/test
 * @access  Private (Admin)
 */
const testRule = asyncHandler(async (req, res) => {
  const { triggerType, condition, action } = req.body;

  if (!triggerType || !action) {
    return res.status(400).json({ success: false, message: 'Trigger type and action are required' });
  }

  const simulation = await simulateRule({ triggerType, condition, action });

  res.status(200).json({
    success: true,
    ...simulation
  });
});

/**
 * @desc    Get automation metrics analytics
 * @route   GET /api/automation/analytics
 * @access  Private (Admin)
 */
const getAutomationAnalytics = asyncHandler(async (req, res) => {
  const totalRules = await AutomationRule.countDocuments({});
  const activeRules = await AutomationRule.countDocuments({ isEnabled: true });

  // Start of today
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // Executions today
  const executionsToday = await AutomationExecution.find({
    executedAt: { $gte: startOfToday }
  });

  const totalExecutionsToday = executionsToday.length;
  const failedExecutions = executionsToday.filter(e => e.executionStatus === 'Failure').length;
  const successfulExecutions = totalExecutionsToday - failedExecutions;

  const successRate = totalExecutionsToday > 0 
    ? Math.round((successfulExecutions / totalExecutionsToday) * 100) 
    : 100;

  const totalRuntime = executionsToday.reduce((sum, e) => sum + e.executionDuration, 0);
  const averageRuntime = totalExecutionsToday > 0 
    ? Math.round(totalRuntime / totalExecutionsToday) 
    : 0;

  res.status(200).json({
    success: true,
    analytics: {
      totalRules,
      activeRules,
      executionsToday: totalExecutionsToday,
      failedExecutions,
      successRate,
      averageRuntime
    }
  });
});

/**
 * @desc    Get execution history logs
 * @route   GET /api/automation/history
 * @access  Private (Admin)
 */
const getExecutionHistory = asyncHandler(async (req, res) => {
  const history = await AutomationExecution.find({})
    .populate('ruleId', 'name')
    .sort({ executedAt: -1 })
    .limit(30);

  res.status(200).json({
    success: true,
    history
  });
});

module.exports = {
  getRules,
  createRule,
  updateRule,
  deleteRule,
  testRule,
  getAutomationAnalytics,
  getExecutionHistory
};
