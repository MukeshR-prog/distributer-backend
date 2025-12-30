const asyncHandler = require('express-async-handler');
const Opportunity = require('../models/Opportunity');
const OpportunityApplication = require('../models/OpportunityApplication');
const CareerProgressionSnapshot = require('../models/CareerProgressionSnapshot');
const { calculatePromotionReadiness } = require('../services/careerProgressionEngine');
const { generateRecommendations } = require('../services/talentMarketplaceEngine');
const { logActivity } = require('../utils/activityLogger');

/**
 * @desc    Get all active, unexpired opportunities
 * @route   GET /api/talent-marketplace/opportunities
 * @access  Private (Agent Only)
 */
const getOpportunities = asyncHandler(async (req, res) => {
  try {
    const opportunities = await Opportunity.find({
      status: 'active',
      expiresAt: { $gte: new Date() }
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      opportunities
    });
  } catch (err) {
    console.error("getOpportunities error:", err.message);
    res.status(200).json({
      success: true,
      opportunities: []
    });
  }
});

/**
 * @desc    Get AI-ranked opportunity recommendations
 * @route   GET /api/talent-marketplace/recommended
 * @access  Private (Agent Only)
 */
const getRecommendedOpportunities = asyncHandler(async (req, res) => {
  try {
    const agentId = req.user._id.toString();
    const recommendations = await generateRecommendations(agentId);

    res.status(200).json({
      success: true,
      recommendations
    });
  } catch (err) {
    console.error("getRecommendedOpportunities error:", err.message);
    res.status(200).json({
      success: true,
      recommendations: []
    });
  }
});

/**
 * @desc    Submit an application for an opportunity
 * @route   POST /api/talent-marketplace/apply/:id
 * @access  Private (Agent Only)
 */
const applyForOpportunity = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const io = req.app.get('io');

  try {
    const opp = await Opportunity.findById(req.params.id);
    if (!opp || opp.status !== 'active' || new Date(opp.expiresAt) < new Date()) {
      return res.status(404).json({
        success: false,
        message: 'Opportunity not found or expired'
      });
    }

    // Check if already applied
    const existingApp = await OpportunityApplication.findOne({
      opportunityId: opp._id,
      agentId
    });

    if (existingApp) {
      return res.status(400).json({
        success: false,
        message: 'You have already applied to this opportunity'
      });
    }

    // Check readiness criteria
    const snapshot = await CareerProgressionSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });
    let readinessScore = 0;
    if (snapshot) {
      readinessScore = snapshot.readinessScore;
    } else {
      const result = await calculatePromotionReadiness(agentId);
      readinessScore = result.readinessScore;
    }

    if (readinessScore < opp.minimumReadinessScore) {
      return res.status(400).json({
        success: false,
        message: `Your career readiness score (${readinessScore}) is below the minimum required (${opp.minimumReadinessScore}) for this opportunity`
      });
    }

    // Save application
    const application = await OpportunityApplication.create({
      opportunityId: opp._id,
      agentId
    });

    // Log activity
    await logActivity({
      actionType: 'OPPORTUNITY_APPLIED',
      entityType: 'Opportunity',
      entityId: opp._id,
      userId: agentId,
      metadata: { title: opp.title, applicationId: application._id }
    }, io);

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      application
    });
  } catch (err) {
    console.error("applyForOpportunity error:", err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to submit application: ' + err.message
    });
  }
});

/**
 * @desc    Get all applications submitted by the logged-in agent
 * @route   GET /api/talent-marketplace/applications
 * @access  Private (Agent Only)
 */
const getApplications = asyncHandler(async (req, res) => {
  try {
    const agentId = req.user._id.toString();
    
    const applications = await OpportunityApplication.find({ agentId })
      .populate('opportunityId')
      .sort({ appliedAt: -1 });

    res.status(200).json({
      success: true,
      applications
    });
  } catch (err) {
    console.error("getApplications error:", err.message);
    res.status(200).json({
      success: true,
      applications: []
    });
  }
});

module.exports = {
  getOpportunities,
  getRecommendedOpportunities,
  applyForOpportunity,
  getApplications
};
