const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getWorkforceIntelligenceDashboard,
  getRecommendations,
  acceptRecommendation,
  dismissRecommendation,
  regenerateRecommendations
} = require('../controllers/workforceIntelligenceController');

const router = express.Router();

// Route middleware restriction: only logged-in administrators can access recommendations
router.use(protect);
router.use(restrictTo('admin'));

router.get('/dashboard', getWorkforceIntelligenceDashboard);
router.get('/recommendations', getRecommendations);
router.post('/:id/accept', acceptRecommendation);
router.post('/:id/dismiss', dismissRecommendation);
router.post('/regenerate', regenerateRecommendations);

module.exports = router;
