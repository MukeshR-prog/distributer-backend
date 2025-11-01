const User = require('../models/User');
const { generateAuthResponse } = require('../utils/jwt');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * @desc    Register user
 * @route   POST /api/auth/register
 * @access  Public (for agents) / Private (for admin creating agents)
 */
const register = asyncHandler(async (req, res) => {
  const { name, email, password, countryCode, phone, role } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: 'User with this email already exists'
    });
  }

  // For agent registration, use provided role or default to 'agent'
  const userRole = role || 'agent';

  // Create user data
  const userData = {
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    role: userRole
  };

  // Add phone details for agents
  if (userRole === 'agent' && countryCode && phone) {
    userData.countryCode = countryCode;
    userData.phone = phone;
  }

  // Create user
  const user = await User.create(userData);

  // Log the creation
  console.log(`✅ New ${user.role} registered: ${user.email}`);

  res.status(201).json(generateAuthResponse(user, `${userRole === 'admin' ? 'Admin' : 'Agent'} account created successfully`));
});

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password, rememberMe } = req.body;

  // Find user with password field included
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  // Check if user is active
  if (!user.isActive) {
    return res.status(401).json({
      success: false,
      message: 'Account is deactivated. Please contact administrator.'
    });
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  // Update last login
  await user.updateLastLogin();

  // Log the login
  console.log(`🔐 User login: ${user.email} (${user.role})`);

  res.json(generateAuthResponse(user, 'Login successful', !!rememberMe));
});

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  res.json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        mobile: user.mobile,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        loginCount: user.loginCount,
        assignedTasks: user.assignedTasks,
        completedTasks: user.completedTasks,
        completionRate: user.completionRate,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    }
  });
});

/**
 * @desc    Update user profile
 * @route   PUT /api/auth/profile
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { name, mobile } = req.body;
  
  const updateData = {};
  if (name) updateData.name = name.trim();
  if (mobile) updateData.mobile = mobile.trim();

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updateData,
    { new: true, runValidators: true }
  );

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: { user }
  });
});

/**
 * @desc    Change password
 * @route   PUT /api/auth/change-password
 * @access  Private
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Get user with password
  const user = await User.findById(req.user._id).select('+password');

  // Check current password
  const isCurrentPasswordValid = await user.comparePassword(currentPassword);
  if (!isCurrentPasswordValid) {
    return res.status(400).json({
      success: false,
      message: 'Current password is incorrect'
    });
  }

  // Update password
  user.password = newPassword;
  await user.save();

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
});

/**
 * @desc    Logout user (client-side token removal)
 * @route   POST /api/auth/logout
 * @access  Private
 */
const logout = asyncHandler(async (req, res) => {
  // In a JWT system, logout is typically handled client-side by removing the token
  // This endpoint can be used for logging purposes or token blacklisting if implemented
  
  console.log(`🔓 User logout: ${req.user.email}`);

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * @desc    Refresh token
 * @route   POST /api/auth/refresh
 * @access  Private
 */
const refreshToken = asyncHandler(async (req, res) => {
  // Generate new token for the current user
  const user = await User.findById(req.user._id);

  if (!user || !user.isActive) {
    return res.status(401).json({
      success: false,
      message: 'User not found or inactive'
    });
  }

  res.json(generateAuthResponse(user, 'Token refreshed successfully'));
});

/**
 * @desc    Get authentication statistics
 * @route   GET /api/auth/stats
 * @access  Private (Admin)
 */
const getAuthStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const stats = await User.aggregate([
    {
      $facet: {
        totalUsers: [{ $count: "count" }],
        activeUsers: [
          { $match: { isActive: true } },
          { $count: "count" }
        ],
        recentLogins24h: [
          { $match: { lastLogin: { $gte: last24Hours } } },
          { $count: "count" }
        ],
        recentLogins7d: [
          { $match: { lastLogin: { $gte: last7Days } } },
          { $count: "count" }
        ],
        usersByRole: [
          { $group: { _id: "$role", count: { $sum: 1 } } }
        ],
        averageLoginCount: [
          { $group: { _id: null, avg: { $avg: "$loginCount" } } }
        ]
      }
    }
  ]);

  const result = stats[0];

  res.json({
    success: true,
    data: {
      totalUsers: result.totalUsers[0]?.count || 0,
      activeUsers: result.activeUsers[0]?.count || 0,
      recentLogins24h: result.recentLogins24h[0]?.count || 0,
      recentLogins7d: result.recentLogins7d[0]?.count || 0,
      averageLoginCount: Math.round(result.averageLoginCount[0]?.avg || 0),
      usersByRole: result.usersByRole || []
    }
  });
});

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  logout,
  refreshToken,
  getAuthStats
};
