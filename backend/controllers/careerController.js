const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const CareerProgressionSnapshot = require('../models/CareerProgressionSnapshot');
const { calculateAgentCareerStats } = require('../services/careerGrowthEngine');
const { generateCareerRoadmap } = require('../services/careerProgressionEngine');

/**
 * @desc    Get agent career stats profile
 * @route   GET /api/career/profile
 * @access  Private (Agent Only)
 */
const getCareerProfile = asyncHandler(async (req, res) => {
  try {
    const agentId = req.user._id.toString();

    const [user, careerStats] = await Promise.all([
      User.findById(agentId).select('-password'),
      calculateAgentCareerStats(agentId)
    ]);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Agent profile not found'
      });
    }

    res.status(200).json({
      success: true,
      profile: {
        user,
        careerStats
      }
    });
  } catch (err) {
    console.error("getCareerProfile error:", err.message);
    res.status(200).json({
      success: true,
      profile: {
        user: req.user,
        careerStats: {
          skillScore: 0,
          learningVelocity: 0,
          completedPathsCount: 0,
          activeStreak: 0,
          growthIndex: 0,
          currentTier: "Associate Agent"
        }
      }
    });
  }
});

/**
 * @desc    Get latest promotion readiness snapshot
 * @route   GET /api/career/readiness
 * @access  Private (Agent Only)
 */
const getPromotionReadiness = asyncHandler(async (req, res) => {
  try {
    const agentId = req.user._id.toString();
    const io = req.app.get('io');

    let snapshot = await CareerProgressionSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });

    if (!snapshot) {
      snapshot = await generateCareerRoadmap(agentId, false, io);
    }

    res.status(200).json({
      success: true,
      snapshot
    });
  } catch (err) {
    console.error("getPromotionReadiness error:", err.message);
    res.status(200).json({
      success: true,
      snapshot: {
        agentId: req.user._id,
        readinessScore: 0,
        currentRole: "Associate Agent",
        nextRole: "Professional Agent",
        strengths: [],
        improvementAreas: [],
        completedRequirements: [],
        pendingRequirements: [],
        estimatedPromotionDate: new Date()
      }
    });
  }
});

/**
 * @desc    Get career progression roadmap checkpoints
 * @route   GET /api/career/roadmap
 * @access  Private (Agent Only)
 */
const getCareerRoadmap = asyncHandler(async (req, res) => {
  try {
    const agentId = req.user._id.toString();
    const io = req.app.get('io');

    let snapshot = await CareerProgressionSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });

    if (!snapshot) {
      snapshot = await generateCareerRoadmap(agentId, false, io);
    }

    res.status(200).json({
      success: true,
      snapshot
    });
  } catch (err) {
    console.error("getCareerRoadmap error:", err.message);
    res.status(200).json({
      success: true,
      snapshot: {
        agentId: req.user._id,
        readinessScore: 0,
        currentRole: "Associate Agent",
        nextRole: "Professional Agent",
        strengths: [],
        improvementAreas: [],
        completedRequirements: [],
        pendingRequirements: [],
        estimatedPromotionDate: new Date()
      }
    });
  }
});

/**
 * @desc    Force regenerate career progression assessment
 * @route   POST /api/career/regenerate
 * @access  Private (Agent Only)
 */
const regenerateCareerSnapshot = asyncHandler(async (req, res) => {
  try {
    const agentId = req.user._id.toString();
    const io = req.app.get('io');

    const snapshot = await generateCareerRoadmap(agentId, true, io);

    res.status(200).json({
      success: true,
      snapshot
    });
  } catch (err) {
    console.error("regenerateCareerSnapshot error:", err.message);
    res.status(200).json({
      success: true,
      snapshot: {
        agentId: req.user._id,
        readinessScore: 0,
        currentRole: "Associate Agent",
        nextRole: "Professional Agent",
        strengths: [],
        improvementAreas: [],
        completedRequirements: [],
        pendingRequirements: [],
        estimatedPromotionDate: new Date()
      }
    });
  }
});

module.exports = {
  getCareerProfile,
  getPromotionReadiness,
  getCareerRoadmap,
  regenerateCareerSnapshot
};
