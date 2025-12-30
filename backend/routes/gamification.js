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
const { requestCache, clearCacheOnMutation } = require('../services/requestCache');

const router = express.Router();

// Enforce authentication guards
router.use(protect);
router.use(restrictTo('agent'));
router.use(clearCacheOnMutation);

router.get('/profile', requestCache(), getGamificationProfile);
router.get('/achievements', requestCache(), getAgentAchievements);
router.get('/rewards', requestCache(), getRewardsTimeline);

// Leaderboard routes
router.get('/leaderboard/season', requestCache(), getSeasonLeaderboard);
router.get('/leaderboard/weekly', requestCache(), getWeeklyLeaderboardHandler);
router.get('/leaderboard/monthly', requestCache(), getMonthlyLeaderboardHandler);
router.get('/leaderboard/all-time', requestCache(), getAllTimeLeaderboardHandler);

// Challenges routes
router.get('/challenges', requestCache(), getChallengesHandler);

// Reward catalog store routes
router.get('/rewards/catalog', requestCache(), getRewardsCatalogHandler);
router.post('/rewards/redeem', redeemRewardHandler);
router.get('/rewards/history', requestCache(), getRedemptionHistoryHandler);
router.post('/rewards/equip-title', equipTitleHandler);
router.post('/rewards/equip-theme', equipThemeHandler);

module.exports = router;
