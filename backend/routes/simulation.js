const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getSimulationHistory,
  getStrategicScenarios,
  runCustomSimulation,
  clearSimulationHistory
} = require('../controllers/simulationController');

const router = express.Router();

// Enforce admin-only access criteria
router.use(protect);
router.use(restrictTo('admin'));

router.get('/history', getSimulationHistory);
router.get('/strategic', getStrategicScenarios);
router.post('/run', runCustomSimulation);
router.post('/clear', clearSimulationHistory);

module.exports = router;
