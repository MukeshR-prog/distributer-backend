const WorkforceRecommendation = require('../models/WorkforceRecommendation');
const workforceEngine = require('../services/workforceIntelligenceEngine');
const { logActivity } = require('../utils/activityLogger');

/**
 * GET /api/workforce-intelligence/dashboard
 * Returns overall workforce insights, critical priorities, and metrics health
 */
exports.getWorkforceIntelligenceDashboard = async (req, res) => {
  try {
    const insights = await workforceEngine.generateExecutiveInsights();
    
    // Fetch critical and high-priority active recommendations
    const criticalRecommendations = await WorkforceRecommendation.find({
      status: 'ACTIVE',
      priority: { $in: ['CRITICAL', 'HIGH'] }
    }).populate('targetId');

    // Fetch historical actions timeline (ACCEPTED or DISMISSED)
    const timeline = await WorkforceRecommendation.find({
      status: { $in: ['ACCEPTED', 'DISMISSED'] }
    }).populate('targetId')
      .sort({ updatedAt: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      data: {
        insights,
        criticalRecommendations,
        timeline
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve workforce intelligence dashboard: ' + err.message
    });
  }
};

/**
 * GET /api/workforce-intelligence/recommendations
 * Returns all active recommendations
 */
exports.getRecommendations = async (req, res) => {
  try {
    const recommendations = await WorkforceRecommendation.find({
      status: 'ACTIVE'
    }).populate('targetId').sort({ confidenceScore: -1 });

    res.status(200).json({
      success: true,
      data: recommendations
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve workforce recommendations: ' + err.message
    });
  }
};

/**
 * POST /api/workforce-intelligence/:id/accept
 * Toggles recommendation status to ACCEPTED
 */
exports.acceptRecommendation = async (req, res) => {
  try {
    const { id } = req.params;
    const recommendation = await WorkforceRecommendation.findById(id);
    
    if (!recommendation) {
      return res.status(404).json({
        success: false,
        message: 'Recommendation not found'
      });
    }

    recommendation.status = 'ACCEPTED';
    await recommendation.save();

    const io = req.app.get('io');
    await logActivity({
      actionType: 'WORKFORCE_RECOMMENDATION_ACCEPTED',
      entityType: 'User',
      entityId: recommendation.targetId,
      userId: req.user?._id || recommendation.targetId,
      metadata: { recommendationType: recommendation.recommendationType, title: recommendation.title }
    }, io);

    if (io) {
      io.emit('workforceRecommendationAction', { id, status: 'ACCEPTED' });
    }

    res.status(200).json({
      success: true,
      message: 'Recommendation accepted successfully',
      data: recommendation
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to accept recommendation: ' + err.message
    });
  }
};

/**
 * POST /api/workforce-intelligence/:id/dismiss
 * Toggles recommendation status to DISMISSED
 */
exports.dismissRecommendation = async (req, res) => {
  try {
    const { id } = req.params;
    const recommendation = await WorkforceRecommendation.findById(id);
    
    if (!recommendation) {
      return res.status(404).json({
        success: false,
        message: 'Recommendation not found'
      });
    }

    recommendation.status = 'DISMISSED';
    await recommendation.save();

    const io = req.app.get('io');
    await logActivity({
      actionType: 'WORKFORCE_RECOMMENDATION_DISMISSED',
      entityType: 'User',
      entityId: recommendation.targetId,
      userId: req.user?._id || recommendation.targetId,
      metadata: { recommendationType: recommendation.recommendationType, title: recommendation.title }
    }, io);

    if (io) {
      io.emit('workforceRecommendationAction', { id, status: 'DISMISSED' });
    }

    res.status(200).json({
      success: true,
      message: 'Recommendation dismissed successfully',
      data: recommendation
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to dismiss recommendation: ' + err.message
    });
  }
};

/**
 * POST /api/workforce-intelligence/regenerate
 * Forces a recalculation scan of recommendation records
 */
exports.regenerateRecommendations = async (req, res) => {
  try {
    const io = req.app.get('io');
    const recommendations = await workforceEngine.generateRecommendations(true, io);

    res.status(200).json({
      success: true,
      message: 'Workforce recommendations regenerated successfully',
      data: {
        count: recommendations.length
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to regenerate workforce recommendations: ' + err.message
    });
  }
};
