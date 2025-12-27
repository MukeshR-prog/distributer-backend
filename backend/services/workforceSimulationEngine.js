const User = require('../models/User');
const SimulationScenario = require('../models/SimulationScenario');
const { calculateCurrentWorkforceMetrics } = require('./workforceOptimizer');
const { calculateProductivityScore } = require('./agentPerformanceEngine');

/**
 * Calculates a composite recommendation score (0-100) based on operational impact and cost
 */
const calculateRecommendationScore = (costImpact, slaImpact, productivityImpact, riskReduction) => {
  // Normalize cost impact (negative cost = savings = positive impact)
  // Base cost impact score: positive savings adds to score, positive expenses subtracts from score
  const costScore = costImpact < 0 ? Math.min(25, Math.abs(costImpact) / 200) : Math.max(0, 25 - (costImpact / 500));
  const slaScore = Math.min(25, Math.max(0, slaImpact * 2.5));
  const prodScore = Math.min(25, Math.max(0, productivityImpact * 2.5));
  const riskScore = Math.min(25, Math.max(0, riskReduction * 2));
  
  return Math.max(10, Math.min(100, Math.round(costScore + slaScore + prodScore + riskScore)));
};

/**
 * Gets live baseline workforce metrics to feed into scenarios
 */
const getBaselineMetrics = async () => {
  const current = await calculateCurrentWorkforceMetrics();
  
  // Calculate average productivity score across active agents
  const agents = await User.find({ role: 'agent', isActive: true });
  let totalProd = 0;
  for (const agent of agents) {
    const scoreRes = await calculateProductivityScore(agent._id);
    totalProd += scoreRes.score || 80;
  }
  const productivity = agents.length > 0 ? Math.round(totalProd / agents.length) : 80;

  return {
    activeAgents: current.activeAgents || 5,
    activeTasks: current.activeTasks || 40,
    slaCompliance: current.slaCompliance || 90,
    riskScore: current.riskScore || 35,
    capacityScore: current.capacityScore || 80,
    productivity,
    operationalHealth: current.workforceEfficiencyScore || 82
  };
};

/**
 * Unified calculation function executing scenario forecast math
 */
const runSimulation = (baseline, config) => {
  const addedAgents = config.addedAgents || 0;
  const removedAgents = config.removedAgents || 0;
  const automationPct = config.automationIncreasePct || 0;
  const shiftTasks = config.reassignedTasksCount || 0;
  const expandedTeamAgents = config.expandedTeamAgents || 0;

  // Calculate simulated agents and tasks count
  const simulatedAgents = Math.max(1, baseline.activeAgents + addedAgents + expandedTeamAgents - removedAgents);
  const taskReduction = Math.round(automationPct * 0.2);
  const simulatedTasks = Math.max(5, baseline.activeTasks - taskReduction);

  // Projected Capacity Score
  const capacityLimit = 15;
  const totalCapacity = simulatedAgents * capacityLimit;
  const workforceCapacity = Math.max(0, Math.min(100, Math.round(100 - (simulatedTasks / totalCapacity) * 100)));
  const capacityGain = workforceCapacity - baseline.capacityScore;

  // Forecast impacts (deltas)
  const slaImpact = Math.round(
    (addedAgents * 2.5) + 
    (expandedTeamAgents * 3.5) - 
    (removedAgents * 5) + 
    (automationPct * 0.15) + 
    (shiftTasks * 0.3)
  );

  const productivityImpact = Math.round(
    (addedAgents * 1.5) + 
    (expandedTeamAgents * 2.0) - 
    (removedAgents * 2.5) + 
    (automationPct * 0.1) + 
    (shiftTasks * 0.1)
  );

  const riskReduction = Math.round(
    (addedAgents * 4) + 
    (expandedTeamAgents * 5) - 
    (removedAgents * 7) + 
    (automationPct * 0.3) + 
    (shiftTasks * 0.4)
  );

  // Financial impact: Salary $4000/mo, Team Expansion setup $4500, Automation saves $150/%, shifts save $50/task
  const costImpact = 
    (addedAgents * 4000) + 
    (expandedTeamAgents * 4500) - 
    (removedAgents * 4000) - 
    (automationPct * 150) - 
    (shiftTasks * 50);

  // Compile final predicted metrics bounded within standard 0-100 ranges
  const slaCompliance = Math.max(10, Math.min(100, Math.round(baseline.slaCompliance + slaImpact)));
  const productivity = Math.max(10, Math.min(100, Math.round(baseline.productivity + productivityImpact)));
  const riskScore = Math.max(5, Math.min(100, Math.round(baseline.riskScore - riskReduction)));
  
  const operationalHealth = Math.max(10, Math.min(100, Math.round(
    (slaCompliance * 0.3) + 
    (workforceCapacity * 0.3) + 
    (productivity * 0.2) + 
    ((100 - riskScore) * 0.2)
  )));

  const recommendationScore = calculateRecommendationScore(costImpact, slaImpact, productivityImpact, riskReduction);

  return {
    predictedMetrics: {
      slaCompliance,
      workforceCapacity,
      productivity,
      riskScore,
      operationalHealth
    },
    recommendationScore,
    costImpact,
    slaImpact,
    productivityImpact,
    riskReduction
  };
};

// Target wrapper functions requested for individual simulation types
const simulateAgentHiring = (baseline, addedCount) => {
  return runSimulation(baseline, { addedAgents: addedCount });
};

const simulateAgentRemoval = (baseline, removedCount) => {
  return runSimulation(baseline, { removedAgents: removedCount });
};

const simulateAutomationIncrease = (baseline, automationPct) => {
  return runSimulation(baseline, { automationIncreasePct: automationPct });
};

const simulateWorkloadShift = (baseline, shiftTasksCount) => {
  return runSimulation(baseline, { reassignedTasksCount: shiftTasksCount });
};

const simulateTeamExpansion = (baseline, teamName, teamAgentsCount) => {
  return runSimulation(baseline, { expandedTeamName: teamName, expandedTeamAgents: teamAgentsCount });
};

/**
 * Generates standard Best, Worst, and Recommended comparison strategic scenarios
 */
const generateStrategicScenarios = async (baseline, userId) => {
  try {
    const strategicScenarios = [];

    // 1. Recommended Case: Balanced optimization (Hire 1 agent, 10% automation, 10 shifted tasks)
    const recConfig = { addedAgents: 1, automationIncreasePct: 10, reassignedTasksCount: 10 };
    const recRes = runSimulation(baseline, recConfig);
    strategicScenarios.push({
      scenarioName: 'Recommended: Balanced Optimization Plan',
      scenarioType: 'CUSTOM',
      assumptions: { ...recConfig, expandedTeamName: '', expandedTeamAgents: 0, removedAgents: 0 },
      ...recRes,
      classification: 'Recommended',
      createdBy: userId
    });

    // 2. Best Case: Maximum operational resilience (Hire 2 agents, 20% automation, 15 shifted tasks)
    const bestConfig = { addedAgents: 2, automationIncreasePct: 20, reassignedTasksCount: 15 };
    const bestRes = runSimulation(baseline, bestConfig);
    strategicScenarios.push({
      scenarioName: 'Best Case: Maximum Operational Resilience',
      scenarioType: 'CUSTOM',
      assumptions: { ...bestConfig, expandedTeamName: '', expandedTeamAgents: 0, removedAgents: 0 },
      ...bestRes,
      classification: 'Best Case',
      createdBy: userId
    });

    // 3. Worst Case: Workforce reduction & minimal automation (Remove 2 agents, no shifts)
    const worstConfig = { removedAgents: 2, automationIncreasePct: 0, reassignedTasksCount: 0 };
    const worstRes = runSimulation(baseline, worstConfig);
    strategicScenarios.push({
      scenarioName: 'Worst Case: Personnel Downsizing',
      scenarioType: 'REMOVAL',
      assumptions: { ...worstConfig, addedAgents: 0, expandedTeamName: '', expandedTeamAgents: 0 },
      ...worstRes,
      classification: 'Worst Case',
      createdBy: userId
    });

    // Clear previous automated classifications
    await SimulationScenario.deleteMany({ classification: { $in: ['Best Case', 'Worst Case', 'Recommended'] } });
    
    // Save to database
    const created = await SimulationScenario.create(strategicScenarios);
    return created;
  } catch (err) {
    console.error('Error seeding strategic scenarios:', err.message);
    throw err;
  }
};

module.exports = {
  getBaselineMetrics,
  runSimulation,
  simulateAgentHiring,
  simulateAgentRemoval,
  simulateAutomationIncrease,
  simulateWorkloadShift,
  simulateTeamExpansion,
  generateStrategicScenarios
};
