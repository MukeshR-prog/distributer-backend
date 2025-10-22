const express = require('express');
const { getAuditLogs, getAuditLogById } = require('../controllers/auditController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Route group requirements
router.use(protect);
router.use(restrictTo('admin'));

router.get('/', getAuditLogs);
router.get('/:id', getAuditLogById);

module.exports = router;
