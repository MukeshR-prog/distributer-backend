const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getLearningPaths,
  getLearningModuleDetails,
  recordLearningProgress,
  getLearningStatistics,
  getDevelopmentPlan,
  regenerateDevelopmentPlan,
  getLearningDashboard,
  getCourses,
  enrollCourse,
  completeCourse,
  getCertifications,
  getRecommendations
} = require('../controllers/learningController');

const router = express.Router();

// Apply protect and restrictTo templates
router.use(protect);
router.use(restrictTo('agent', 'admin', 'executive'));

router.get('/paths', getLearningPaths);
router.get('/modules/:id', getLearningModuleDetails);
router.post('/progress', recordLearningProgress);
router.get('/progress', getLearningStatistics);
router.get('/development-plan', getDevelopmentPlan);
router.post('/regenerate-plan', regenerateDevelopmentPlan);

// New enterprise LMS routes
router.get('/dashboard', getLearningDashboard);
router.get('/courses', getCourses);
router.post('/enroll', enrollCourse);
router.post('/complete', completeCourse);
router.get('/certifications', getCertifications);
router.get('/recommendations', getRecommendations);

module.exports = router;
