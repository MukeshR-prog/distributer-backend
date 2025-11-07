const express = require('express');
const { getAgentAnalytics, getWorkloadAnalytics, getPerformanceAnalytics, getRiskAnalytics } = require('../controllers/analyticsController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Route group configuration
router.use(protect);
router.use(restrictTo('admin'));

router.get('/agents', getAgentAnalytics);
router.get('/workload', getWorkloadAnalytics);
router.get('/performance', getPerformanceAnalytics);
router.get('/risk', getRiskAnalytics);

module.exports = router;
