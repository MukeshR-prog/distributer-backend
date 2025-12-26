const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getSuccessionDashboard,
  getSuccessionCandidates,
  getSuccessionPipeline,
  regenerateSuccessionPlanning
} = require('../controllers/successionController');

const router = express.Router();

// Apply authentication protection and restrict access to administrators
router.use(protect);
router.use(restrictTo('admin'));

router.get('/dashboard', getSuccessionDashboard);
router.get('/candidates', getSuccessionCandidates);
router.get('/pipeline', getSuccessionPipeline);
router.post('/regenerate', regenerateSuccessionPlanning);

module.exports = router;
