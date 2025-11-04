const express = require('express');
const { getAgentAnalytics, getWorkloadAnalytics } = require('../controllers/analyticsController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Route group configuration
router.use(protect);
router.use(restrictTo('admin'));

router.get('/agents', getAgentAnalytics);
router.get('/workload', getWorkloadAnalytics);

module.exports = router;
