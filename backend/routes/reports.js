const express = require('express');
const {
  getReportsHistory,
  generateReportAction,
  getReportById
} = require('../controllers/reportController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Apply admin protection middleware
router.use(protect);
router.use(restrictTo('admin'));

// Route configurations
router.get('/', getReportsHistory);
router.get('/generate', generateReportAction);
router.get('/:id', getReportById);

module.exports = router;
