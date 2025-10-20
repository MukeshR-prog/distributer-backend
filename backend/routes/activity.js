const express = require('express');
const { getActivityLogs } = require('../controllers/activityController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Route group requirements
router.use(protect);
router.use(restrictTo('admin'));

router.get('/', getActivityLogs);

module.exports = router;
