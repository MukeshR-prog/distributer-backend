const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getSecurityDashboard,
  getRoleTemplates,
  createRoleTemplate,
  updateRoleTemplate,
  deleteRoleTemplate,
  getAccessReviewUsers,
  updateUserAccessStatus,
  runSecurityScan
} = require('../controllers/securityController');

const router = express.Router();

// Apply auth and admin checks for all routes
router.use(protect);
router.use(restrictTo('admin'));

router.get('/dashboard', getSecurityDashboard);
router.get('/scan', runSecurityScan);

router.route('/roles')
  .get(getRoleTemplates)
  .post(createRoleTemplate);

router.route('/roles/:id')
  .patch(updateRoleTemplate)
  .delete(deleteRoleTemplate);

router.get('/access-review', getAccessReviewUsers);
router.patch('/access-review/:userId', updateUserAccessStatus);

module.exports = router;
