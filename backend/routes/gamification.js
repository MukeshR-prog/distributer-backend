const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const {
  getGamificationProfile,
  getAgentAchievements,
  getRewardsTimeline,
  getSeasonLeaderboard,
  getWeeklyLeaderboardHandler,
  getMonthlyLeaderboardHandler,
  getAllTimeLeaderboardHandler,
  getChallengesHandler,
  getRewardsCatalogHandler,
  redeemRewardHandler,
  getRedemptionHistoryHandler,
  equipTitleHandler,
  equipThemeHandler
} = require('../controllers/gamificationController');

const router = express.Router();

// Enforce authentication guards
router.use(protect);
router.use(restrictTo('agent'));

router.get('/profile', getGamificationProfile);
router.get('/achievements', getAgentAchievements);
router.get('/rewards', getRewardsTimeline);

// Leaderboard routes
router.get('/leaderboard/season', getSeasonLeaderboard);
router.get('/leaderboard/weekly', getWeeklyLeaderboardHandler);
router.get('/leaderboard/monthly', getMonthlyLeaderboardHandler);
router.get('/leaderboard/all-time', getAllTimeLeaderboardHandler);

// Challenges routes
router.get('/challenges', getChallengesHandler);

// Reward catalog store routes
router.get('/rewards/catalog', getRewardsCatalogHandler);
router.post('/rewards/redeem', redeemRewardHandler);
router.get('/rewards/history', getRedemptionHistoryHandler);
router.post('/rewards/equip-title', equipTitleHandler);
router.post('/rewards/equip-theme', equipThemeHandler);

module.exports = router;
