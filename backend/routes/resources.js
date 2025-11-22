const express = require('express');
const {
  getAllocations,
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  getPlans,
  createPlan,
  updatePlanStatus
} = require('../controllers/resourceController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Apply auth protection & admin restriction to all resource endpoints
router.use(protect);
router.use(restrictTo('admin'));

router.get('/allocations', getAllocations);
router.get('/teams', getTeams);
router.post('/teams', createTeam);
router.patch('/teams/:id', updateTeam);
router.delete('/teams/:id', deleteTeam);
router.get('/plans', getPlans);
router.post('/plans', createPlan);
router.patch('/plans/:id/status', updatePlanStatus);

module.exports = router;
