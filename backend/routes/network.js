const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getNetworkDashboard,
  getNetworkInfluencers,
  getNetworkRisks,
  getNetworkTeams,
  recalculateNetworkMetrics
} = require('../controllers/networkController');

const router = express.Router();

// Enforce admin-only credentials
router.use(protect);
router.use(restrictTo('admin'));

router.get('/dashboard', getNetworkDashboard);
router.get('/influencers', getNetworkInfluencers);
router.get('/risks', getNetworkRisks);
router.get('/teams', getNetworkTeams);
router.post('/recalculate', recalculateNetworkMetrics);

module.exports = router;
