const mongoose = require('mongoose');

const simulationScenarioSchema = new mongoose.Schema({
  scenarioName: {
    type: String,
    required: true
  },
  scenarioType: {
    type: String,
    required: true,
    enum: ['HIRING', 'REMOVAL', 'AUTOMATION', 'WORKLOAD_SHIFT', 'TEAM_EXPANSION', 'CUSTOM']
  },
  assumptions: {
    addedAgents: { type: Number, default: 0 },
    removedAgents: { type: Number, default: 0 },
    automationIncreasePct: { type: Number, default: 0 },
    reassignedTasksCount: { type: Number, default: 0 },
    expandedTeamName: { type: String, default: "" },
    expandedTeamAgents: { type: Number, default: 0 }
  },
  predictedMetrics: {
    slaCompliance: { type: Number, required: true },
    workforceCapacity: { type: Number, required: true },
    productivity: { type: Number, required: true },
    riskScore: { type: Number, required: true },
    operationalHealth: { type: Number, required: true }
  },
  recommendationScore: {
    type: Number,
    default: 0
  },
  costImpact: {
    type: Number,
    default: 0
  },
  slaImpact: {
    type: Number,
    default: 0
  },
  productivityImpact: {
    type: Number,
    default: 0
  },
  riskReduction: {
    type: Number,
    default: 0
  },
  classification: {
    type: String,
    enum: ['Best Case', 'Worst Case', 'Recommended', 'Standard'],
    default: 'Standard'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  generatedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: { createdAt: 'generatedAt', updatedAt: false }
});

module.exports = mongoose.model('SimulationScenario', simulationScenarioSchema);
