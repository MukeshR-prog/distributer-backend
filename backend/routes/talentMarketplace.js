const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getOpportunities,
  getRecommendedOpportunities,
  applyForOpportunity,
  getApplications
} = require('../controllers/talentMarketplaceController');

const router = express.Router();

// Apply protect and restrictTo agent templates
router.use(protect);
router.use(restrictTo('agent'));

router.get('/opportunities', getOpportunities);
router.get('/recommended', getRecommendedOpportunities);
router.post('/apply/:id', applyForOpportunity);
router.get('/applications', getApplications);

module.exports = router;
