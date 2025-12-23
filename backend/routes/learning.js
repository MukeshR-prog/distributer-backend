const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getLearningPaths,
  getLearningModuleDetails,
  recordLearningProgress,
  getLearningStatistics
} = require('../controllers/learningController');

const router = express.Router();

// Apply protect and restrictTo agent templates
router.use(protect);
router.use(restrictTo('agent'));

router.get('/paths', getLearningPaths);
router.get('/modules/:id', getLearningModuleDetails);
router.post('/progress', recordLearningProgress);
router.get('/progress', getLearningStatistics);

module.exports = router;
