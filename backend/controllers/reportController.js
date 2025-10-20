const Report = require('../models/Report');
const { generateReportData } = require('../utils/reportGenerator');
const { asyncHandler } = require('../middleware/errorHandler');
const { logActivity } = require('../utils/activityLogger');

/**
 * @desc    Get all reports history (metadata only or full depending on list context)
 * @route   GET /api/reports
 * @access  Private (Admin)
 */
const getReportsHistory = asyncHandler(async (req, res) => {
  // Query all reports, populating generatedBy name and email
  const reports = await Report.find({})
    .populate('generatedBy', 'name email')
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: reports.length,
    reports
  });
});

/**
 * @desc    Generate a new analytics report and store snapshot in database
 * @route   GET /api/reports/generate
 * @access  Private (Admin)
 */
const generateReportAction = asyncHandler(async (req, res) => {
  const { from, to, type } = req.query;

  if (!type || !['analytics', 'leaderboard', 'performance'].includes(type)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid report type (analytics, leaderboard, or performance)'
    });
  }

  // Generate structured report content using report generator utility
  const reportPayload = await generateReportData({ from, to, type });

  // Save report snapshot metadata & data payload in MongoDB
  const newReport = await Report.create({
    reportType: type,
    dateRange: {
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null
    },
    generatedBy: req.user._id,
    data: reportPayload
  });

  // Log activity
  await logActivity({
    actionType: 'REPORT_GENERATED',
    entityType: 'Report',
    entityId: newReport._id,
    userId: req.user._id,
    metadata: {
      reportId: newReport._id,
      reportType: newReport.reportType,
      dateRange: newReport.dateRange
    }
  }, req.app.get('io'));

  // Populate generatedBy name & email for the response
  const populatedReport = await Report.findById(newReport._id).populate('generatedBy', 'name email');

  res.status(201).json({
    success: true,
    report: populatedReport
  });
});

/**
 * @desc    Get a single report detailed snapshot by ID
 * @route   GET /api/reports/:id
 * @access  Private (Admin)
 */
const getReportById = asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id).populate('generatedBy', 'name email');

  if (!report) {
    return res.status(404).json({
      success: false,
      message: 'Report not found'
    });
  }

  res.status(200).json({
    success: true,
    report
  });
});

module.exports = {
  getReportsHistory,
  generateReportAction,
  getReportById
};
