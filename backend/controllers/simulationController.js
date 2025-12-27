const SimulationScenario = require('../models/SimulationScenario');
const simulationEngine = require('../services/workforceSimulationEngine');
const { logActivity } = require('../utils/activityLogger');

/**
 * GET /api/simulation/history
 * Returns historical custom simulations ran by administrators
 */
exports.getSimulationHistory = async (req, res) => {
  try {
    const history = await SimulationScenario.find({ classification: 'Standard' })
      .sort({ generatedAt: -1 })
      .populate('createdBy', 'name email');

    res.status(200).json({
      success: true,
      data: history
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve simulation history: ' + err.message
    });
  }
};

/**
 * GET /api/simulation/strategic
 * Seeding and returning Best, Worst, and Recommended strategic scenario summaries
 */
exports.getStrategicScenarios = async (req, res) => {
  try {
    const baseline = await simulationEngine.getBaselineMetrics();
    const seeded = await simulationEngine.generateStrategicScenarios(baseline, req.user._id);

    res.status(200).json({
      success: true,
      baseline,
      data: seeded
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve strategic scenarios: ' + err.message
    });
  }
};

/**
 * POST /api/simulation/run
 * Computes custom planning values, creates a database log, and returns predicted states
 */
exports.runCustomSimulation = async (req, res) => {
  try {
    const {
      scenarioName = "Custom Scenario Simulation",
      scenarioType = "CUSTOM",
      addedAgents = 0,
      removedAgents = 0,
      automationIncreasePct = 0,
      reassignedTasksCount = 0,
      expandedTeamName = "",
      expandedTeamAgents = 0
    } = req.body;

    const baseline = await simulationEngine.getBaselineMetrics();
    
    const config = {
      addedAgents,
      removedAgents,
      automationIncreasePct,
      reassignedTasksCount,
      expandedTeamName,
      expandedTeamAgents
    };

    const results = simulationEngine.runSimulation(baseline, config);

    // Save standard run to database history log
    const scenario = await SimulationScenario.create({
      scenarioName,
      scenarioType,
      assumptions: config,
      predictedMetrics: results.predictedMetrics,
      recommendationScore: results.recommendationScore,
      costImpact: results.costImpact,
      slaImpact: results.slaImpact,
      productivityImpact: results.productivityImpact,
      riskReduction: results.riskReduction,
      classification: 'Standard',
      createdBy: req.user._id
    });

    const io = req.app.get('io');
    await logActivity({
      actionType: 'WORKFORCE_SIMULATION_EXECUTED',
      entityType: 'User',
      entityId: req.user._id,
      userId: req.user._id,
      metadata: { scenarioId: scenario._id, scenarioName, type: scenarioType }
    }, io);

    res.status(201).json({
      success: true,
      message: 'Simulation calculated and saved to history successfully',
      baseline,
      data: scenario
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to compute scenario simulation: ' + err.message
    });
  }
};

/**
 * POST /api/simulation/clear
 * Deletes past simulation history runs
 */
exports.clearSimulationHistory = async (req, res) => {
  try {
    await SimulationScenario.deleteMany({ classification: 'Standard' });

    res.status(200).json({
      success: true,
      message: 'Simulation history logs cleared successfully'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to clear simulation history: ' + err.message
    });
  }
};
