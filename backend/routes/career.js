const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getCareerProfile,
  getPromotionReadiness,
  getCareerRoadmap,
  regenerateCareerSnapshot
} = require('../controllers/careerController');

const router = express.Router();

// Apply protect and restrictTo agent templates
router.use(protect);
router.use(restrictTo('agent'));

router.get('/profile', getCareerProfile);
router.get('/readiness', getPromotionReadiness);
router.get('/roadmap', getCareerRoadmap);
router.post('/regenerate', regenerateCareerSnapshot);

module.exports = router;
