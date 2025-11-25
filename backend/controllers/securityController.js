const SecurityEvent = require('../models/SecurityEvent');
const RoleTemplate = require('../models/RoleTemplate');
const User = require('../models/User');
const Incident = require('../models/Incident');
const { runThreatAnalysis } = require('../services/securityAnalyzer');
const { asyncHandler } = require('../middleware/errorHandler');

// 10-minute in-memory cache structure
let dashboardCache = {
  data: null,
  timestamp: null
};

const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * @desc    Auto-seed default role templates if they don't exist
 */
const seedRoleTemplates = async () => {
  const count = await RoleTemplate.countDocuments({});
  if (count > 0) return;

  const defaultRoles = [
    {
      name: 'Super Admin',
      code: 'super_admin',
      description: 'Full administrative access to all system variables, role overrides, and operational systems.',
      permissions: ['*'],
      isSystem: true
    },
    {
      name: 'Operations Manager',
      code: 'operations_manager',
      description: 'Full workload, distribution, and automation controls. Read access to security dashboard.',
      permissions: ['dashboard.read', 'agents.manage', 'distributions.manage', 'automation.manage', 'reports.read', 'security.read'],
      isSystem: true
    },
    {
      name: 'Team Lead',
      code: 'team_lead',
      description: 'Management access for agent monitoring, assignments review, and standard dashboards.',
      permissions: ['dashboard.read', 'agents.manage', 'reports.read', 'security.read'],
      isSystem: true
    },
    {
      name: 'Agent',
      code: 'agent',
      description: 'Standard worker access. Able to view own workload, status logs, and updates.',
      permissions: ['dashboard.read'],
      isSystem: true
    },
    {
      name: 'Read Only Auditor',
      code: 'read_only_auditor',
      description: 'Compliance auditing access. Read-only permissions for activity trails, logs, and security scores.',
      permissions: ['dashboard.read', 'reports.read', 'security.read'],
      isSystem: true
    }
  ];

  await RoleTemplate.insertMany(defaultRoles);
  console.log('🛡️  Default Role Templates successfully seeded.');
};

/**
 * @desc    Seed historical security events if none exist
 */
const seedSecurityEvents = async () => {
  const count = await SecurityEvent.countDocuments({});
  if (count > 0) return;

  const users = await User.find({});
  const adminUser = users.find(u => u.role === 'admin') || null;
  const agentUser = users.find(u => u.role === 'agent') || null;

  const now = new Date();
  const mockEvents = [
    {
      eventType: 'Login Success',
      userId: adminUser?._id,
      severity: 'low',
      metadata: { email: adminUser?.email || 'admin@example.com', ipAddress: '192.168.1.50', userAgent: 'Chrome on macOS' },
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000)
    },
    {
      eventType: 'Agent Creation',
      userId: adminUser?._id,
      severity: 'low',
      metadata: { agentName: 'John Doe', agentEmail: 'john@example.com' },
      createdAt: new Date(now.getTime() - 20 * 60 * 60 * 1000)
    },
    {
      eventType: 'Login Failure',
      userId: null,
      severity: 'medium',
      metadata: { email: 'unknown_agent@example.com', reason: 'User not found', ipAddress: '45.76.12.98', userAgent: 'Mozilla/5.0' },
      createdAt: new Date(now.getTime() - 15 * 60 * 60 * 1000)
    },
    {
      eventType: 'Login Failure',
      userId: agentUser?._id,
      severity: 'medium',
      metadata: { email: agentUser?.email || 'agent@example.com', reason: 'Incorrect password', ipAddress: '192.168.1.110', userAgent: 'Firefox on Windows' },
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000)
    },
    {
      eventType: 'Login Failure',
      userId: agentUser?._id,
      severity: 'medium',
      metadata: { email: agentUser?.email || 'agent@example.com', reason: 'Incorrect password', ipAddress: '192.168.1.110', userAgent: 'Firefox on Windows' },
      createdAt: new Date(now.getTime() - 1.9 * 60 * 60 * 1000)
    },
    {
      eventType: 'Login Failure',
      userId: agentUser?._id,
      severity: 'medium',
      metadata: { email: agentUser?.email || 'agent@example.com', reason: 'Incorrect password', ipAddress: '192.168.1.110', userAgent: 'Firefox on Windows' },
      createdAt: new Date(now.getTime() - 1.8 * 60 * 60 * 1000) // This triggers the brute force alert!
    },
    {
      eventType: 'Automation Changes',
      userId: adminUser?._id,
      severity: 'low',
      metadata: { action: 'Updated rule SLA Risk Alert', ruleId: 'mock_rule_id' },
      createdAt: new Date(now.getTime() - 1 * 60 * 60 * 1000)
    }
  ];

  await SecurityEvent.insertMany(mockEvents);
  console.log('🛡️  Mock Security Events successfully seeded.');
};

/**
 * @desc    Get security dashboard overview
 * @route   GET /api/security/dashboard
 * @access  Private (Admin)
 */
const getSecurityDashboard = asyncHandler(async (req, res) => {
  const now = Date.now();

  // Check cache hit
  if (dashboardCache.data && dashboardCache.timestamp && (now - dashboardCache.timestamp < CACHE_TTL_MS)) {
    console.log('⚡ [SecurityController] Serving dashboard from cache.');
    return res.status(200).json({
      success: true,
      data: dashboardCache.data
    });
  }

  // Pre-seed if required
  await seedRoleTemplates();
  await seedSecurityEvents();

  // Run dynamic scanning
  const analysis = await runThreatAnalysis();

  // Fetch security event history
  const securityEvents = await SecurityEvent.find({})
    .sort({ createdAt: -1 })
    .populate('userId', 'name email role')
    .limit(100);

  // Fetch role templates
  const roleTemplates = await RoleTemplate.find({});

  // Compute compliance metrics
  const activeUsersCount = await User.countDocuments({ isActive: true });
  const failedLoginsCount = await SecurityEvent.countDocuments({
    eventType: 'Login Failure',
    createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) } // Failed logins in last 24h
  });
  const permissionChangesCount = await SecurityEvent.countDocuments({
    eventType: { $in: ['Permission Changes', 'Role Updates'] },
    createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) }
  });

  // Security Incidents: Count open incidents (from Incident collection or custom severity alerts)
  const openIncidentsCount = await Incident.countDocuments({ status: { $ne: 'resolved' } });

  // Access Reviews Pending: Active users who haven't logged in for 30+ days
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const pendingReviewsCount = await User.countDocuments({
    isActive: true,
    $or: [
      { lastLogin: { $lte: thirtyDaysAgo } },
      { lastLogin: null, createdAt: { $lte: thirtyDaysAgo } }
    ]
  });

  const payload = {
    securityMetrics: {
      securityScore: analysis.securityScore,
      activeUsers: activeUsersCount,
      failedLogins: failedLoginsCount,
      permissionChanges: permissionChangesCount,
      securityIncidents: openIncidentsCount,
      pendingAccessReviews: pendingReviewsCount
    },
    securityEvents,
    riskIndicators: analysis.alerts,
    securityRecommendations: analysis.recommendations,
    roleTemplates
  };

  dashboardCache = {
    data: payload,
    timestamp: now
  };

  res.status(200).json({
    success: true,
    data: payload
  });
});

/**
 * @desc    Get all role templates
 * @route   GET /api/security/roles
 * @access  Private (Admin)
 */
const getRoleTemplates = asyncHandler(async (req, res) => {
  await seedRoleTemplates();
  const roles = await RoleTemplate.find({});
  res.status(200).json({
    success: true,
    data: roles
  });
});

/**
 * @desc    Create a new role template
 * @route   POST /api/security/roles
 * @access  Private (Admin)
 */
const createRoleTemplate = asyncHandler(async (req, res) => {
  const { name, code, description, permissions } = req.body;

  if (!name || !code) {
    res.status(400);
    throw new Error('Role name and unique code are required');
  }

  const existing = await RoleTemplate.findOne({ code: code.toLowerCase() });
  if (existing) {
    res.status(400);
    throw new Error('Role code already exists');
  }

  const template = await RoleTemplate.create({
    name,
    code: code.toLowerCase(),
    description,
    permissions: permissions || [],
    isSystem: false
  });

  // Log security event
  await SecurityEvent.create({
    eventType: 'Role Updates',
    userId: req.user._id,
    severity: 'medium',
    metadata: {
      action: 'Created custom role template',
      roleCode: template.code,
      roleName: template.name
    }
  });

  // Clear cache
  dashboardCache = { data: null, timestamp: null };

  res.status(201).json({
    success: true,
    data: template
  });
});

/**
 * @desc    Update a role template
 * @route   PATCH /api/security/roles/:id
 * @access  Private (Admin)
 */
const updateRoleTemplate = asyncHandler(async (req, res) => {
  const { name, description, permissions } = req.body;
  const template = await RoleTemplate.findById(req.params.id);

  if (!template) {
    res.status(404);
    throw new Error('Role template not found');
  }

  const previousPermissions = [...template.permissions];

  if (name) template.name = name;
  if (description) template.description = description;
  if (permissions) template.permissions = permissions;

  await template.save();

  // Log permission changes
  await SecurityEvent.create({
    eventType: 'Permission Changes',
    userId: req.user._id,
    severity: 'medium',
    metadata: {
      action: `Updated permissions on role: ${template.code}`,
      roleCode: template.code,
      previous: previousPermissions,
      current: template.permissions
    }
  });

  // Clear cache
  dashboardCache = { data: null, timestamp: null };

  res.status(200).json({
    success: true,
    data: template
  });
});

/**
 * @desc    Delete a role template
 * @route   DELETE /api/security/roles/:id
 * @access  Private (Admin)
 */
const deleteRoleTemplate = asyncHandler(async (req, res) => {
  const template = await RoleTemplate.findById(req.params.id);

  if (!template) {
    res.status(404);
    throw new Error('Role template not found');
  }

  if (template.isSystem) {
    res.status(400);
    throw new Error('Cannot delete system protected templates');
  }

  await RoleTemplate.findByIdAndDelete(req.params.id);

  // Log event
  await SecurityEvent.create({
    eventType: 'Role Updates',
    userId: req.user._id,
    severity: 'medium',
    metadata: {
      action: `Deleted custom role template: ${template.code}`
    }
  });

  // Clear cache
  dashboardCache = { data: null, timestamp: null };

  res.status(200).json({
    success: true,
    message: 'Role template deleted successfully'
  });
});

/**
 * @desc    Get users list for Access Review
 * @route   GET /api/security/access-review
 * @access  Private (Admin)
 */
const getAccessReviewUsers = asyncHandler(async (req, res) => {
  // Fetch users, return essential metadata and role info
  const users = await User.find({})
    .sort({ lastLogin: -1, createdAt: -1 });

  res.status(200).json({
    success: true,
    data: users
  });
});

/**
 * @desc    Update a user access profile (Role changes, Suspension)
 * @route   PATCH /api/security/access-review/:userId
 * @access  Private (Admin)
 */
const updateUserAccessStatus = asyncHandler(async (req, res) => {
  const { roleTemplate, isActive } = req.body;
  const user = await User.findById(req.params.userId);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const oldRoleTemplate = user.roleTemplate;
  const oldActive = user.isActive;

  if (roleTemplate !== undefined) {
    user.roleTemplate = roleTemplate;
    // Keep user.role aligned: if the role template is super_admin or operations_manager, set user.role to 'admin'. Otherwise 'agent'.
    if (['super_admin', 'operations_manager'].includes(roleTemplate)) {
      user.role = 'admin';
    } else {
      user.role = 'agent';
    }
  }

  if (isActive !== undefined) {
    user.isActive = isActive;
  }

  await user.save();

  // Log events if changed
  if (oldRoleTemplate !== user.roleTemplate) {
    await SecurityEvent.create({
      eventType: 'Role Updates',
      userId: req.user._id,
      severity: 'high',
      metadata: {
        action: `Assigned user ${user.email} from role ${oldRoleTemplate} to ${user.roleTemplate}`,
        targetUser: user.email
      }
    });
  }

  if (oldActive !== user.isActive) {
    await SecurityEvent.create({
      eventType: 'Agent Creation', // Agent deactivation/activation event
      userId: req.user._id,
      severity: 'medium',
      metadata: {
        action: `User ${user.email} access status set to ${user.isActive ? 'Active' : 'Suspended'}`,
        targetUser: user.email
      }
    });
  }

  // Clear cache
  dashboardCache = { data: null, timestamp: null };

  res.status(200).json({
    success: true,
    message: 'User access parameters updated successfully',
    data: user
  });
});

/**
 * @desc    Run immediate security audit scan
 * @route   GET /api/security/scan
 * @access  Private (Admin)
 */
const runSecurityScan = asyncHandler(async (req, res) => {
  // Clear cache
  dashboardCache = { data: null, timestamp: null };

  // Pre-seed if required
  await seedRoleTemplates();
  await seedSecurityEvents();

  const analysis = await runThreatAnalysis();

  res.status(200).json({
    success: true,
    message: 'Security threat analysis completed successfully.',
    data: {
      securityScore: analysis.securityScore,
      riskIndicators: analysis.alerts,
      securityRecommendations: analysis.recommendations
    }
  });
});

module.exports = {
  getSecurityDashboard,
  getRoleTemplates,
  createRoleTemplate,
  updateRoleTemplate,
  deleteRoleTemplate,
  getAccessReviewUsers,
  updateUserAccessStatus,
  runSecurityScan
};
