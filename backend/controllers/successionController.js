const successionEngine = require('../services/successionEngine');

/**
 * GET /api/succession/dashboard
 * Returns overall statistics for succession planning
 */
exports.getSuccessionDashboard = async (req, res) => {
  try {
    const candidates = await successionEngine.getLatestCandidates();
    
    if (candidates.length === 0) {
      // Trigger initial scan if no candidates exist
      const io = req.app.get('io');
      await successionEngine.identifyHighPotentialEmployees(true, io);
      return res.redirect('/api/succession/dashboard');
    }

    const totalCandidates = candidates.length;
    const tierCounts = {
      'Strategic Successor': 0,
      'High Potential': 0,
      'Leadership Ready': 0,
      'Emerging Leader': 0
    };

    let totalLeadership = 0;
    let totalReadiness = 0;

    candidates.forEach(c => {
      tierCounts[c.successionTier] = (tierCounts[c.successionTier] || 0) + 1;
      totalLeadership += c.leadershipScore || 0;
      totalReadiness += c.readinessScore || 0;
    });

    const averageLeadershipScore = totalCandidates > 0 ? Math.round(totalLeadership / totalCandidates) : 0;
    const averageReadinessScore = totalCandidates > 0 ? Math.round(totalReadiness / totalCandidates) : 0;

    const recentCandidates = [...candidates]
      .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))
      .slice(0, 5);

    res.status(200).json({
      success: true,
      data: {
        totalCandidates,
        tierCounts,
        averageLeadershipScore,
        averageReadinessScore,
        recentCandidates
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve succession dashboard metrics: ' + err.message
    });
  }
};

/**
 * GET /api/succession/candidates
 * Returns all active candidate profiles with development recommendations
 */
exports.getSuccessionCandidates = async (req, res) => {
  try {
    const candidates = await successionEngine.getLatestCandidates();
    
    const candidatesWithRecommendations = candidates.map(c => {
      const recommendations = successionEngine.generateDevelopmentRecommendations(c);
      return {
        ...(c.toObject ? c.toObject() : c),
        developmentRecommendations: recommendations
      };
    });

    res.status(200).json({
      success: true,
      data: candidatesWithRecommendations
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve succession candidates: ' + err.message
    });
  }
};

/**
 * GET /api/succession/pipeline
 * Returns succession pipelines ranked by leadership/readiness scores
 */
exports.getSuccessionPipeline = async (req, res) => {
  try {
    const pipelines = await successionEngine.generateSuccessionPipeline();
    res.status(200).json({
      success: true,
      data: pipelines
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve succession pipelines: ' + err.message
    });
  }
};

/**
 * POST /api/succession/regenerate
 * Recalculates succession rankings and pipelines
 */
exports.regenerateSuccessionPlanning = async (req, res) => {
  try {
    const io = req.app.get('io');
    const candidates = await successionEngine.identifyHighPotentialEmployees(true, io);
    
    if (io) {
      io.emit('successionPipelineUpdated', { message: 'Succession pipeline regenerated successfully' });
    }

    const pipelines = await successionEngine.generateSuccessionPipeline();

    res.status(200).json({
      success: true,
      message: 'Succession pipeline recalculated successfully',
      data: {
        candidatesCount: candidates.length,
        pipelines
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to regenerate succession planning pipeline: ' + err.message
    });
  }
};
