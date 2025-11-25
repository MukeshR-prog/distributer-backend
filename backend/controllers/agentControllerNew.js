const User = require('../models/User');
const SecurityEvent = require('../models/SecurityEvent');
const Record = require('../models/Record');
const { asyncHandler } = require('../middleware/errorHandler');
const { buildFilters } = require('../utils/filterBuilder');
const { logActivity } = require('../utils/activityLogger');
const { logAudit } = require('../utils/auditLogger');

/**
 * @desc    Get all agents
 * @route   GET /api/agents
 * @access  Private (Admin)
 */
const getAgents = asyncHandler(async (req, res) => {
  const filters = buildFilters(req.query, 'agent');
  const agents = await User.find(filters)
    .select('-password')
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: agents.length,
    agents
  });
});

/**
 * @desc    Create new agent
 * @route   POST /api/agents
 * @access  Private (Admin)
 */
const createAgent = asyncHandler(async (req, res) => {
  const { name, email, countryCode, phone, password } = req.body;

  // Check if agent already exists
  const existingAgent = await User.findOne({ email });
  if (existingAgent) {
    return res.status(400).json({
      success: false,
      message: 'Agent with this email already exists'
    });
  }

  // Create agent
  const agent = await User.create({
    name,
    email,
    countryCode,
    phone,
    password,
    role: 'agent',
    isActive: true
  });

  // Remove password from response
  agent.password = undefined;

  // Log activity
  await logActivity({
    actionType: 'AGENT_CREATED',
    entityType: 'User',
    entityId: agent._id,
    userId: req.user._id,
    metadata: {
      agentId: agent._id,
      agentName: agent.name,
      agentEmail: agent.email
    }
  }, req.app.get('io'));

  // Log audit
  await logAudit({
    actionType: 'AGENT_CREATED',
    entityType: 'User',
    entityId: agent._id,
    previousState: null,
    newState: agent.toObject ? agent.toObject() : agent,
    userId: req.user._id,
    ipAddress: req.ip || req.headers['x-forwarded-for'],
    userAgent: req.headers['user-agent']
  });

  // Log security event
  await SecurityEvent.create({
    eventType: 'Agent Creation',
    userId: req.user._id,
    severity: 'low',
    metadata: {
      action: 'Created new agent',
      agentId: agent._id,
      agentName: agent.name,
      agentEmail: agent.email
    }
  });

  res.status(201).json({
    success: true,
    message: 'Agent created successfully',
    agent
  });
});

/**
 * @desc    Get single agent
 * @route   GET /api/agents/:id
 * @access  Private (Admin)
 */
const getAgent = asyncHandler(async (req, res) => {
  const agent = await User.findById(req.params.id).select('-password');

  if (!agent || agent.role !== 'agent') {
    return res.status(404).json({
      success: false,
      message: 'Agent not found'
    });
  }

  // Get agent statistics
  const totalRecords = await Record.countDocuments({ assignedAgent: agent._id });
  const pendingRecords = await Record.countDocuments({ 
    assignedAgent: agent._id, 
    status: 'pending' 
  });
  const completedRecords = await Record.countDocuments({ 
    assignedAgent: agent._id, 
    status: 'completed' 
  });

  res.status(200).json({
    success: true,
    agent: {
      ...agent.toObject(),
      stats: {
        totalRecords,
        pendingRecords,
        completedRecords
      }
    }
  });
});

/**
 * @desc    Update agent
 * @route   PUT /api/agents/:id
 * @access  Private (Admin)
 */
const updateAgent = asyncHandler(async (req, res) => {
  const agent = await User.findById(req.params.id);

  if (!agent || agent.role !== 'agent') {
    return res.status(404).json({
      success: false,
      message: 'Agent not found'
    });
  }

  // Check if email is being updated and if it's unique
  if (req.body.email && req.body.email !== agent.email) {
    const existingAgent = await User.findOne({ email: req.body.email });
    if (existingAgent) {
      return res.status(400).json({
        success: false,
        message: 'Email already in use'
      });
    }
  }

  const previousState = agent.toObject ? agent.toObject() : agent;
  previousState.password = undefined;

  const updatedAgent = await User.findByIdAndUpdate(
    req.params.id,
    req.body,
    {
      new: true,
      runValidators: true
    }
  ).select('-password');

  // Log audit
  await logAudit({
    actionType: 'AGENT_UPDATED',
    entityType: 'User',
    entityId: updatedAgent._id,
    previousState,
    newState: updatedAgent.toObject ? updatedAgent.toObject() : updatedAgent,
    userId: req.user._id,
    ipAddress: req.ip || req.headers['x-forwarded-for'],
    userAgent: req.headers['user-agent']
  });

  res.status(200).json({
    success: true,
    message: 'Agent updated successfully',
    agent: updatedAgent
  });
});

/**
 * @desc    Delete agent
 * @route   DELETE /api/agents/:id
 * @access  Private (Admin)
 */
const deleteAgent = asyncHandler(async (req, res) => {
  const agent = await User.findById(req.params.id);

  if (!agent || agent.role !== 'agent') {
    return res.status(404).json({
      success: false,
      message: 'Agent not found'
    });
  }

  // Check if agent has any assigned records
  const assignedRecords = await Record.countDocuments({ assignedAgent: agent._id });
  
  if (assignedRecords > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete agent. Agent has ${assignedRecords} assigned records. Please reassign or complete these records first.`
    });
  }

  const previousState = agent.toObject ? agent.toObject() : agent;
  previousState.password = undefined;

  await User.findByIdAndDelete(req.params.id);

  // Log activity
  await logActivity({
    actionType: 'AGENT_DELETED',
    entityType: 'User',
    entityId: agent._id,
    userId: req.user._id,
    metadata: {
      agentId: agent._id,
      agentName: agent.name,
      agentEmail: agent.email
    }
  }, req.app.get('io'));

  // Log audit
  await logAudit({
    actionType: 'AGENT_DELETED',
    entityType: 'User',
    entityId: agent._id,
    previousState,
    newState: null,
    userId: req.user._id,
    ipAddress: req.ip || req.headers['x-forwarded-for'],
    userAgent: req.headers['user-agent']
  });

  // Log security event
  await SecurityEvent.create({
    eventType: 'Agent Creation', // User changes / agent deletions are logged as Agent Creation events
    userId: req.user._id,
    severity: 'medium',
    metadata: {
      action: 'Deactivated/Deleted agent account',
      agentId: agent._id,
      agentName: agent.name,
      agentEmail: agent.email
    }
  });

  res.status(200).json({
    success: true,
    message: 'Agent deleted successfully'
  });
});

/**
 * @desc    Get agent statistics
 * @route   GET /api/agents/stats
 * @access  Private (Admin)
 */
const getAgentStats = asyncHandler(async (req, res) => {
  const totalAgents = await User.countDocuments({ role: 'agent' });
  const activeAgents = await User.countDocuments({ role: 'agent', status: 'active' });
  const totalRecords = await Record.countDocuments();
  const completedRecords = await Record.countDocuments({ status: 'completed' });

  // Get top performing agents
  const agentPerformance = await Record.aggregate([
    {
      $group: {
        _id: '$assignedAgent',
        totalRecords: { $sum: 1 },
        completedRecords: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'agent'
      }
    },
    {
      $unwind: '$agent'
    },
    {
      $project: {
        agentName: '$agent.name',
        agentEmail: '$agent.email',
        totalRecords: 1,
        completedRecords: 1,
        completionRate: {
          $cond: [
            { $eq: ['$totalRecords', 0] },
            0,
            { $multiply: [{ $divide: ['$completedRecords', '$totalRecords'] }, 100] }
          ]
        }
      }
    },
    {
      $sort: { completionRate: -1, completedRecords: -1 }
    },
    {
      $limit: 5
    }
  ]);

  res.status(200).json({
    success: true,
    stats: {
      totalAgents,
      activeAgents,
      totalRecords,
      completedRecords,
      completionRate: totalRecords > 0 ? ((completedRecords / totalRecords) * 100).toFixed(2) : 0,
      topPerformers: agentPerformance
    }
  });
});

/**
 * @desc    Get all agent assignments
 * @route   GET /api/agents/assignments
 * @access  Private (Admin)
 */
const getAgentAssignments = asyncHandler(async (req, res) => {
  const assignments = await Record.aggregate([
    {
      $group: {
        _id: '$assignedAgent',
        totalRecords: { $sum: 1 },
        pendingRecords: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        inProgressRecords: { $sum: { $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0] } },
        completedRecords: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelledRecords: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'agent'
      }
    },
    {
      $unwind: '$agent'
    },
    {
      $project: {
        agentId: '$_id',
        agentName: '$agent.name',
        agentEmail: '$agent.email',
        agentMobile: '$agent.mobile',
        agentStatus: '$agent.status',
        totalRecords: 1,
        pendingRecords: 1,
        inProgressRecords: 1,
        completedRecords: 1,
        cancelledRecords: 1,
        completionRate: {
          $cond: [
            { $eq: ['$totalRecords', 0] },
            0,
            { $multiply: [{ $divide: ['$completedRecords', '$totalRecords'] }, 100] }
          ]
        }
      }
    },
    {
      $sort: { agentName: 1 }
    }
  ]);

  res.status(200).json({
    success: true,
    assignments
  });
});

module.exports = {
  getAgents,
  createAgent,
  getAgent,
  updateAgent,
  deleteAgent,
  getAgentStats,
  getAgentAssignments
};
