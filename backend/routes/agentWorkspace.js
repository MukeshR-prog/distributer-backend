const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const { getWorkspaceData } = require('../controllers/agentWorkspaceController');

const router = express.Router();

// Apply auth and agent checks for all routes
router.use(protect);
router.use(restrictTo('agent'));

router.get('/workspace', getWorkspaceData);

module.exports = router;
