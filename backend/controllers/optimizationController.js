const { asyncHandler } = require('../middleware/errorHandler');
const CapacitySnapshot = require('../models/CapacitySnapshot');
const OptimizationImpactSnapshot = require('../models/OptimizationImpactSnapshot');
const {
  calculateCurrentWorkforceMetrics,
  getTeamCapacityBenchmarking,
  getWorkforceForecasts,
  generateOptimizationRecommendations,
  runScenarioSimulation,
  backfillCapacitySnapshots,
  seedOptimizationImpacts
} = require('../services/workforceOptimizer');

// 15-minute in-memory cache structure
let cache = {
  data: null,
  timestamp: null
};

const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Calculates percentage changes for workforce metrics.
 */
const calculateChange = (curr, prev) => {
  if (!prev) return 0;
  return Math.round(((curr - prev) / prev) * 100 * 10) / 10;
};

/**
 * @desc    Get Workforce Optimization dashboard metrics
 * @route   GET /api/optimization/dashboard
 * @access  Private (Admin)
 */
const getOptimizationDashboard = asyncHandler(async (req, res) => {
  const nowTime = Date.now();

  // Check cache hit
  if (cache.data && cache.timestamp && (nowTime - cache.timestamp < CACHE_TTL_MS)) {
    console.log('⚡ [OptimizationController] Serving from in-memory cache.');
    return res.status(200).json({
      success: true,
      data: cache.data
    });
  }

  // Backfill snapshots if not already present
  await backfillCapacitySnapshots();
  await seedOptimizationImpacts();

  // 1. Gather Current Metrics & Comparisons
  const currentMetrics = await calculateCurrentWorkforceMetrics();

  // Get previous snapshot (e.g. from 24h/1 day ago)
  const yesterdayLimit = new Date();
  yesterdayLimit.setHours(0, 0, 0, 0);

  const prevSnapshot = await CapacitySnapshot.findOne({
    generatedAt: { $lt: yesterdayLimit }
  }).sort({ generatedAt: -1 });

  const prev = prevSnapshot || {
    utilizationRate: currentMetrics.utilizationRate,
    capacityScore: currentMetrics.capacityScore,
    workforceEfficiencyScore: currentMetrics.workforceEfficiencyScore,
    slaCompliance: currentMetrics.slaCompliance,
    riskScore: currentMetrics.riskScore
  };

  const capacityMetrics = {
    activeAgents: currentMetrics.activeAgents,
    activeTasks: currentMetrics.activeTasks,
    workloadRatio: currentMetrics.workloadRatio,
    utilizationRate: {
      currentValue: currentMetrics.utilizationRate,
      previousValue: prev.utilizationRate,
      percentageChange: calculateChange(currentMetrics.utilizationRate, prev.utilizationRate)
    },
    capacityScore: {
      currentValue: currentMetrics.capacityScore,
      previousValue: prev.capacityScore,
      percentageChange: calculateChange(currentMetrics.capacityScore, prev.capacityScore)
    },
    workforceEfficiencyScore: {
      currentValue: currentMetrics.workforceEfficiencyScore,
      previousValue: prev.workforceEfficiencyScore,
      percentageChange: calculateChange(currentMetrics.workforceEfficiencyScore, prev.workforceEfficiencyScore)
    },
    slaCompliance: {
      currentValue: currentMetrics.slaCompliance,
      previousValue: prev.slaCompliance,
      percentageChange: calculateChange(currentMetrics.slaCompliance, prev.slaCompliance)
    },
    riskScore: {
      currentValue: currentMetrics.riskScore,
      previousValue: prev.riskScore,
      percentageChange: calculateChange(currentMetrics.riskScore, prev.riskScore)
    }
  };

  // 2. Fetch Team Benchmarking data
  const utilizationMetrics = await getTeamCapacityBenchmarking();

  // 3. Bottleneck Analysis
  const bottlenecks = utilizationMetrics.filter(b => b.category === 'Overloaded');

  // 4. Generate recommendations
  const recommendations = await generateOptimizationRecommendations();

  // 5. Calculate forecasts
  const forecasts = await getWorkforceForecasts();

  // 6. Fetch recent optimization impact snaps
  const impactSnapshots = await OptimizationImpactSnapshot.find({})
    .sort({ generatedAt: -1 })
    .limit(10);

  // Success rate of resolved impact snapshots
  const completedSnaps = await OptimizationImpactSnapshot.find({ status: 'completed' });
  const totalSnaps = await OptimizationImpactSnapshot.countDocuments({});
  const successRate = totalSnaps > 0 ? Math.round((completedSnaps.length / totalSnaps) * 100) : 100;

  // Retrieve last 90 daily snapshots for trend line graphs
  const snapshotsList = await CapacitySnapshot.find({})
    .sort({ generatedAt: 1 })
    .limit(90);

  const payload = {
    capacityMetrics,
    utilizationMetrics,
    bottlenecks,
    recommendations,
    forecasts,
    impactSnapshots: {
      list: impactSnapshots,
      successRate,
      totalApplied: totalSnaps
    },
    snapshotsList: snapshotsList.map(s => ({
      date: s.generatedAt,
      utilization: s.utilizationRate,
      capacity: s.capacityScore,
      sla: s.slaCompliance,
      efficiency: s.workforceEfficiencyScore
    }))
  };

  // Cache payload
  cache = {
    data: payload,
    timestamp: nowTime
  };

  res.status(200).json({
    success: true,
    data: payload
  });
});

/**
 * @desc    Simulate scenario planning inputs and predict deltas
 * @route   POST /api/optimization/simulate
 * @access  Private (Admin)
 */
const simulateScenario = asyncHandler(async (req, res) => {
  const { addedAgents, removedAgents, automationIncreasePct, reassignedTasksCount } = req.body;

  const simulationDeltas = await runScenarioSimulation({
    addedAgents: Number(addedAgents || 0),
    removedAgents: Number(removedAgents || 0),
    automationIncreasePct: Number(automationIncreasePct || 0),
    reassignedTasksCount: Number(reassignedTasksCount || 0)
  });

  res.status(200).json({
    success: true,
    data: simulationDeltas
  });
});

/**
 * @desc    Apply and track optimization recommendation impact
 * @route   POST /api/optimization/recommendations/:id/apply
 * @access  Private (Admin)
 */
const applyRecommendation = asyncHandler(async (req, res) => {
  const { recommendationType, expectedImpact } = req.body;

  if (!recommendationType || !expectedImpact) {
    res.status(400);
    throw new Error('Recommendation parameters are required to log impact');
  }

  const snapshot = await OptimizationImpactSnapshot.create({
    recommendationType,
    expectedImpact,
    status: 'pending'
  });

  // Reset dashboard cache to reflect applied status
  cache = { data: null, timestamp: null };

  res.status(201).json({
    success: true,
    data: snapshot
  });
});

module.exports = {
  getOptimizationDashboard,
  simulateScenario,
  applyRecommendation
};
