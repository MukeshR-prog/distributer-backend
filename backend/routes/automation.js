const express = require('express');
const { 
  getRules, 
  createRule, 
  updateRule, 
  deleteRule, 
  testRule, 
  getAutomationAnalytics, 
  getExecutionHistory 
} = require('../controllers/automationController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Apply auth protection & admin restriction to all automation endpoints
router.use(protect);
router.use(restrictTo('admin'));

router.get('/', getRules);
router.post('/', createRule);
router.put('/:id', updateRule);
router.delete('/:id', deleteRule);
router.post('/test', testRule);
router.get('/analytics', getAutomationAnalytics);
router.get('/history', getExecutionHistory);

module.exports = router;
