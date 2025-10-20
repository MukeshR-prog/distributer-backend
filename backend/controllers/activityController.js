const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * @desc    Get paginated and filtered activity logs
 * @route   GET /api/activity
 * @access  Private (Admin)
 */
const getActivityLogs = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const skip = (page - 1) * limit;

  const query = {};

  // Action type matching
  if (req.query.actionType) {
    query.actionType = req.query.actionType;
  }

  // Date range parsing
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

  // Text query search
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    
    // Find matching users to filter by performedBy reference
    const matchingUsers = await User.find({ name: searchRegex }).select('_id');
    const userIds = matchingUsers.map(u => u._id);

    query.$or = [
      { actionType: searchRegex },
      { 'metadata.agentName': searchRegex },
      { 'metadata.agentEmail': searchRegex },
      { 'metadata.fileName': searchRegex },
      { 'metadata.reportType': searchRegex },
      { performedBy: { $in: userIds } }
    ];
  }

  // Query database
  const logs = await ActivityLog.find(query)
    .populate('performedBy', 'name email role')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await ActivityLog.countDocuments(query);

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

module.exports = {
  getActivityLogs
};
