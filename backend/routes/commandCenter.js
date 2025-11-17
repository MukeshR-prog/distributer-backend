const express = require('express');
const {
  getWarRoomOverview,
  getIncidents,
  updateIncidentStatus,
  getNotes,
  createNote,
  togglePinNote,
  getWarRoomActions
} = require('../controllers/commandCenterController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Apply auth protection & admin restriction to all command center endpoints
router.use(protect);
router.use(restrictTo('admin'));

router.get('/overview', getWarRoomOverview);
router.get('/incidents', getIncidents);
router.patch('/incidents/:id', updateIncidentStatus);
router.get('/notes', getNotes);
router.post('/notes', createNote);
router.patch('/notes/:id/pin', togglePinNote);
router.get('/actions', getWarRoomActions);

module.exports = router;
