const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * @desc    Get paginated and filtered audit logs
 * @route   GET /api/audit
 * @access  Private (Admin)
 */
const getAuditLogs = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const skip = (page - 1) * limit;

  const query = {};

  // Action type matching
  if (req.query.actionType) {
    query.actionType = req.query.actionType;
  }

  // Entity type matching
  if (req.query.entityType) {
    query.entityType = req.query.entityType;
  }

  // Date range filtering
  if (req.query.from || req.query.to) {
    query.createdAt = {};
    if (req.query.from) {
      query.createdAt.$gte = new Date(req.query.from);
    }
    if (req.query.to) {
      const end = new Date(req.query.to);
      if (req.query.to.length <= 10) {
        end.setHours(23, 59, 59, 999);
      }
      query.createdAt.$lte = end;
    }
  }

  // Search filter
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    
    // Find matching users to filter by performedBy reference
    const matchingUsers = await User.find({ name: searchRegex }).select('_id');
    const userIds = matchingUsers.map(u => u._id);

    query.$or = [
      { actionType: searchRegex },
      { entityType: searchRegex },
      { ipAddress: searchRegex },
      { performedBy: { $in: userIds } }
    ];
  }

  // Query database
  const logs = await AuditLog.find(query)
    .populate('performedBy', 'name email role')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await AuditLog.countDocuments(query);

  res.status(200).json({
    success: true,
    data: {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

/**
 * @desc    Get detailed audit log by ID
 * @route   GET /api/audit/:id
 * @access  Private (Admin)
 */
const getAuditLogById = asyncHandler(async (req, res) => {
  const log = await AuditLog.findById(req.params.id).populate('performedBy', 'name email role');

  if (!log) {
    return res.status(404).json({
      success: false,
      message: 'Audit log entry not found'
    });
  }

  res.status(200).json({
    success: true,
    log
  });
});

module.exports = {
  getAuditLogs,
  getAuditLogById
};
