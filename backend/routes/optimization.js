const express = require('express');
const {
  getOptimizationDashboard,
  simulateScenario,
  applyRecommendation
} = require('../controllers/optimizationController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Apply auth protection & admin restriction to all optimization endpoints
router.use(protect);
router.use(restrictTo('admin'));

router.get('/dashboard', getOptimizationDashboard);
router.post('/simulate', simulateScenario);
router.post('/recommendations/:id/apply', applyRecommendation);

module.exports = router;
