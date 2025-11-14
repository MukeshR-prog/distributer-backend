const express = require('express');
const { getExecutiveDashboard } = require('../controllers/executiveController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Apply auth protection & admin restriction to all executive endpoints
router.use(protect);
router.use(restrictTo('admin'));

router.get('/dashboard', getExecutiveDashboard);

module.exports = router;
