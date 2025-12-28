const networkEngine = require('../services/networkIntelligenceEngine');
const NetworkSnapshot = require('../models/NetworkSnapshot');
const { logActivity } = require('../utils/activityLogger');

/**
 * GET /api/network/dashboard
 * Returns the latest NetworkSnapshot or runs calculation on the fly
 */
exports.getNetworkDashboard = async (req, res) => {
  try {
    let latestSnapshot = await NetworkSnapshot.findOne({}).sort({ generatedAt: -1 });

    if (!latestSnapshot) {
      // Seed initial calculation if none exist
      const initial = await networkEngine.generateNetworkHealth();
      latestSnapshot = initial.snapshot;
    }

    res.status(200).json({
      success: true,
      data: latestSnapshot
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve organizational network dashboard: ' + err.message
    });
  }
};

/**
 * GET /api/network/influencers
 * Returns influencer leaderboard categories
 */
exports.getNetworkInfluencers = async (req, res) => {
  try {
    const influencers = await networkEngine.identifyKeyContributors();
    res.status(200).json({
      success: true,
      data: influencers
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve network influencers: ' + err.message
    });
  }
};

/**
 * GET /api/network/risks
 * Returns detected isolated employees, knowledge silos, and bottlenecks
 */
exports.getNetworkRisks = async (req, res) => {
  try {
    const risks = await networkEngine.identifyOrganizationalRisks();
    res.status(200).json({
      success: true,
      data: risks
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve organizational risks: ' + err.message
    });
  }
};

/**
 * GET /api/network/teams
 * Returns team connectivity matrix heatmap datasets
 */
exports.getNetworkTeams = async (req, res) => {
  try {
    const teamsData = await networkEngine.getTeamConnectivityMatrix();
    res.status(200).json({
      success: true,
      data: teamsData
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve team connectivity matrix: ' + err.message
    });
  }
};

/**
 * POST /api/network/recalculate
 * Triggers live recalculation and logging of network metrics
 */
exports.recalculateNetworkMetrics = async (req, res) => {
  try {
    const io = req.app.get('io');
    const result = await networkEngine.generateNetworkHealth();

    await logActivity({
      actionType: 'NETWORK_INTELLIGENCE_RECALCULATED',
      entityType: 'User',
      entityId: req.user._id,
      userId: req.user._id,
      metadata: { snapshotId: result.snapshot._id }
    }, io);

    res.status(201).json({
      success: true,
      message: 'Network intelligence metrics recalculated and logged successfully',
      data: result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to execute live network recalculations: ' + err.message
    });
  }
};
