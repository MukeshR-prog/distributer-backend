const { asyncHandler } = require('../middleware/errorHandler');
const Team = require('../models/Team');
const User = require('../models/User');
const AllocationPlan = require('../models/AllocationPlan');
const {
  syncTeamMembers,
  calculateTeamsMetrics,
  autoSeedInitialTeams,
  generateReallocationRecommendations,
  executeTaskTransfer
} = require('../services/resourceAllocator');

// 10-minute in-memory cache structure
let cache = {
  data: null,
  timestamp: null
};

const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * @desc    Get smart allocations and team metrics overview
 * @route   GET /api/resources/allocations
 * @access  Private (Admin)
 */
const getAllocations = asyncHandler(async (req, res) => {
  const now = Date.now();

  // Check cache hit
  if (cache.data && cache.timestamp && (now - cache.timestamp < CACHE_TTL_MS)) {
    console.log('⚡ [ResourceController] Serving allocations from cache.');
    return res.status(200).json({
      success: true,
      data: cache.data
    });
  }

  // Ensure initial seed runs and metrics are fresh
  await autoSeedInitialTeams();
  await calculateTeamsMetrics();

  const teams = await Team.find({})
    .populate('manager', 'name email role')
    .populate('members', 'name email role assignedTasks completedTasks completionRate');

  const allocations = await AllocationPlan.find({})
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name')
    .populate('sourceTeam', 'name')
    .populate('targetTeam', 'name');

  const recommendations = await generateReallocationRecommendations();
  const bottlenecks = teams.filter(t => t.utilizationRate > 85);

  const payload = {
    teams,
    allocations,
    recommendations,
    bottlenecks
  };

  cache = {
    data: payload,
    timestamp: now
  };

  res.status(200).json({
    success: true,
    data: payload
  });
});

/**
 * @desc    Get all teams
 * @route   GET /api/resources/teams
 * @access  Private (Admin)
 */
const getTeams = asyncHandler(async (req, res) => {
  const teams = await Team.find({})
    .populate('manager', 'name email role')
    .populate('members', 'name email role');

  res.status(200).json({
    success: true,
    data: teams
  });
});

/**
 * @desc    Create a new team
 * @route   POST /api/resources/teams
 * @access  Private (Admin)
 */
const createTeam = asyncHandler(async (req, res) => {
  const { name, department, managerId, members } = req.body;

  if (!name || !department) {
    res.status(400);
    throw new Error('Team name and department are required');
  }

  const team = await Team.create({
    name,
    department,
    manager: managerId || null,
    members: members || []
  });

  await syncTeamMembers(team._id);
  await calculateTeamsMetrics();

  const populated = await Team.findById(team._id)
    .populate('manager', 'name email role')
    .populate('members', 'name email role');

  // Reset cache
  cache = { data: null, timestamp: null };

  res.status(201).json({
    success: true,
    data: populated
  });
});

/**
 * @desc    Update a team configuration
 * @route   PATCH /api/resources/teams/:id
 * @access  Private (Admin)
 */
const updateTeam = asyncHandler(async (req, res) => {
  const { name, department, managerId, members } = req.body;
  const team = await Team.findById(req.params.id);

  if (!team) {
    res.status(404);
    throw new Error('Team not found');
  }

  if (name) team.name = name;
  if (department) team.department = department;
  if (managerId !== undefined) team.manager = managerId || null;
  if (members) team.members = members;

  await team.save();
  await syncTeamMembers(team._id);
  await calculateTeamsMetrics();

  const populated = await Team.findById(team._id)
    .populate('manager', 'name email role')
    .populate('members', 'name email role');

  // Reset cache
  cache = { data: null, timestamp: null };

  res.status(200).json({
    success: true,
    data: populated
  });
});

/**
 * @desc    Delete a team
 * @route   DELETE /api/resources/teams/:id
 * @access  Private (Admin)
 */
const deleteTeam = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);

  if (!team) {
    res.status(404);
    throw new Error('Team not found');
  }

  // Reset member profiles team parameters
  await User.updateMany(
    { team: team.name, role: 'agent' },
    { team: 'Default Team', department: 'General Operations' }
  );

  await Team.findByIdAndDelete(req.params.id);

  // Reset cache
  cache = { data: null, timestamp: null };

  res.status(200).json({
    success: true,
    message: 'Team deleted successfully'
  });
});

/**
 * @desc    Get all allocation plans
 * @route   GET /api/resources/plans
 * @access  Private (Admin)
 */
const getPlans = asyncHandler(async (req, res) => {
  const plans = await AllocationPlan.find({})
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name')
    .populate('sourceTeam', 'name')
    .populate('targetTeam', 'name');

  res.status(200).json({
    success: true,
    data: plans
  });
});

/**
 * @desc    Create a new task allocation plan
 * @route   POST /api/resources/plans
 * @access  Private (Admin)
 */
const createPlan = asyncHandler(async (req, res) => {
  const { title, sourceTeamId, targetTeamId, taskCount, expectedImpact } = req.body;

  if (!title || !sourceTeamId || !targetTeamId || !taskCount || !expectedImpact) {
    res.status(400);
    throw new Error('All plan variables are required');
  }

  const plan = await AllocationPlan.create({
    title,
    createdBy: req.user._id,
    sourceTeam: sourceTeamId,
    targetTeam: targetTeamId,
    taskCount: Number(taskCount),
    expectedImpact
  });

  const populated = await AllocationPlan.findById(plan._id)
    .populate('createdBy', 'name')
    .populate('sourceTeam', 'name')
    .populate('targetTeam', 'name');

  // Reset cache
  cache = { data: null, timestamp: null };

  res.status(201).json({
    success: true,
    data: populated
  });
});

/**
 * @desc    Update allocation plan status (Apply transfers)
 * @route   PATCH /api/resources/plans/:id/status
 * @access  Private (Admin)
 */
const updatePlanStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const plan = await AllocationPlan.findById(req.params.id);

  if (!plan) {
    res.status(404);
    throw new Error('Allocation plan not found');
  }

  if (plan.status === 'Applied') {
    res.status(400);
    throw new Error('Allocation plan has already been executed');
  }

  plan.status = status;
  await plan.save();

  let transferMetrics = null;

  // Execute actual task migration if Approved/Applied
  if (status === 'Applied') {
    transferMetrics = await executeTaskTransfer(plan._id);
  }

  const populated = await AllocationPlan.findById(plan._id)
    .populate('createdBy', 'name')
    .populate('sourceTeam', 'name')
    .populate('targetTeam', 'name');

  // Reset cache
  cache = { data: null, timestamp: null };

  res.status(200).json({
    success: true,
    data: {
      plan: populated,
      transferMetrics
    }
  });
});

module.exports = {
  getAllocations,
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  getPlans,
  createPlan,
  updatePlanStatus
};
