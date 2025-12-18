const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Achievement = require('../models/Achievement');
const AgentAchievement = require('../models/AgentAchievement');
const { evaluateAchievements } = require('../services/achievementEngine');

const {
  getCurrentSeason,
  checkAndClosePastSeasons,
  getPeriodLeaderboard,
  getWeeklyLeaderboard,
  getMonthlyLeaderboard,
  getAllTimeLeaderboard
} = require('../services/leaderboardEngine');
const { evaluateChallenges } = require('../services/challengeEngine');
const {
  seedRewards,
  redeemReward,
  equipTitle,
  equipTheme,
  getRedemptionHistory
} = require('../services/rewardEngine');
const RewardCatalog = require('../models/RewardCatalog');

// Maps numeric level to gamified operational status tier name
const getLevelTierName = (level) => {
  if (level >= 20) return "Diamond Tier";
  if (level >= 15) return "Platinum Tier";
  if (level >= 10) return "Gold Tier";
  if (level >= 5) return "Silver Tier";
  return "Bronze Tier";
};

/**
 * @desc    Get Agent Gamification Profile (Level, XP, Points, Streaks)
 * @route   GET /api/gamification/profile
 * @access  Private (Agent Only)
 */
const getGamificationProfile = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();

  // Run dynamic evaluation to ensure alignment with completed tasks
  const stats = await evaluateAchievements(agentId, req.app.get('io'));

  const user = await User.findById(agentId);
  const tierName = getLevelTierName(user.level || 1);

  // 1000 XP required per level
  const currentXPInLevel = (user.xp || 0) % 1000;
  const xpProgressPercent = Math.round((currentXPInLevel / 1000) * 100);

  res.status(200).json({
    success: true,
    points: user.points || 0,
    xp: user.xp || 0,
    level: user.level || 1,
    levelName: tierName,
    currentStreak: user.currentStreak || 0,
    longestStreak: user.longestStreak || 0,
    currentXPInLevel,
    xpProgressPercent,
    xpNextLevel: 1000,
    selectedTitle: user.selectedTitle || '',
    selectedTheme: user.selectedTheme || ''
  });
});

/**
 * @desc    Get All Agent Achievements with Current Progress
 * @route   GET /api/gamification/achievements
 * @access  Private (Agent Only)
 */
const getAgentAchievements = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();

  // Pre-evaluate to verify fresh calculations
  await evaluateAchievements(agentId, req.app.get('io'));

  const achievements = await Achievement.find();
  const agentProgress = await AgentAchievement.find({ agentId });
  
  const progressMap = new Map(agentProgress.map(ap => [ap.achievementId.toString(), ap]));

  const merged = achievements.map(ach => {
    const progress = progressMap.get(ach._id.toString());
    return {
      id: ach._id,
      title: ach.title,
      description: ach.description,
      category: ach.category,
      criteria: ach.criteria,
      pointsReward: ach.pointsReward,
      badgeIcon: ach.badgeIcon,
      difficulty: ach.difficulty,
      currentValue: progress ? progress.currentValue : 0,
      targetValue: progress ? progress.targetValue : ach.criteria.threshold,
      progressPercent: progress ? progress.progressPercent : 0,
      isUnlocked: progress ? progress.isUnlocked : false,
      unlockedAt: progress ? progress.unlockedAt : null
    };
  });

  res.status(200).json({
    success: true,
    achievements: merged
  });
});

/**
 * @desc    Get Rewards Timeline Milestone Checkpoints
 * @route   GET /api/gamification/rewards
 * @access  Private (Agent Only)
 */
const getRewardsTimeline = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const user = await User.findById(agentId);
  const currentLevel = user.level || 1;

  const milestones = [
    { level: 1, title: "Bronze Tier Unlocked", pointsReward: 100, isUnlocked: currentLevel >= 1 },
    { level: 5, title: "Silver Tier Unlocked", pointsReward: 500, isUnlocked: currentLevel >= 5 },
    { level: 10, title: "Gold Tier Unlocked", pointsReward: 1000, isUnlocked: currentLevel >= 10 },
    { level: 15, title: "Platinum Tier Unlocked", pointsReward: 2000, isUnlocked: currentLevel >= 15 },
    { level: 20, title: "Diamond Tier Unlocked", pointsReward: 5000, isUnlocked: currentLevel >= 20 }
  ];

  res.status(200).json({
    success: true,
    milestones
  });
});

/**
 * @desc    Get Current Season and Leaderboard Standings
 * @route   GET /api/gamification/leaderboard/season
 * @access  Private (Agent Only)
 */
const getSeasonLeaderboard = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  await checkAndClosePastSeasons(io);
  const season = await getCurrentSeason();
  const standings = await getPeriodLeaderboard(season.startDate, season.endDate);
  
  res.status(200).json({
    success: true,
    season: {
      id: season._id,
      seasonName: season.seasonName,
      startDate: season.startDate,
      endDate: season.endDate,
      rewards: season.rewards
    },
    standings
  });
});

/**
 * @desc    Get Weekly Leaderboard Standings
 * @route   GET /api/gamification/leaderboard/weekly
 * @access  Private (Agent Only)
 */
const getWeeklyLeaderboardHandler = asyncHandler(async (req, res) => {
  const standings = await getWeeklyLeaderboard();
  res.status(200).json({
    success: true,
    standings
  });
});

/**
 * @desc    Get Monthly Leaderboard Standings
 * @route   GET /api/gamification/leaderboard/monthly
 * @access  Private (Agent Only)
 */
const getMonthlyLeaderboardHandler = asyncHandler(async (req, res) => {
  const standings = await getMonthlyLeaderboard();
  res.status(200).json({
    success: true,
    standings
  });
});

/**
 * @desc    Get All-Time Leaderboard Standings
 * @route   GET /api/gamification/leaderboard/all-time
 * @access  Private (Agent Only)
 */
const getAllTimeLeaderboardHandler = asyncHandler(async (req, res) => {
  const standings = await getAllTimeLeaderboard();
  res.status(200).json({
    success: true,
    standings
  });
});

/**
 * @desc    Get and evaluate agent active daily/weekly challenges
 * @route   GET /api/gamification/challenges
 * @access  Private (Agent Only)
 */
const getChallengesHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const io = req.app.get('io');
  const challenges = await evaluateChallenges(agentId, io);
  
  res.status(200).json({
    success: true,
    challenges
  });
});

/**
 * @desc    Get Rewards Catalog
 * @route   GET /api/gamification/rewards/catalog
 * @access  Private (Agent Only)
 */
const getRewardsCatalogHandler = asyncHandler(async (req, res) => {
  await seedRewards();
  const catalog = await RewardCatalog.find().sort({ costPoints: 1 });
  
  const user = await User.findById(req.user._id);
  
  res.status(200).json({
    success: true,
    catalog,
    unlockedTitles: user.unlockedTitles || [],
    unlockedThemes: user.unlockedThemes || [],
    selectedTitle: user.selectedTitle || '',
    selectedTheme: user.selectedTheme || ''
  });
});

/**
 * @desc    Redeem reward from catalog
 * @route   POST /api/gamification/rewards/redeem
 * @access  Private (Agent Only)
 */
const redeemRewardHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { catalogId } = req.body;
  const io = req.app.get('io');

  if (!catalogId) {
    return res.status(400).json({ success: false, message: "catalogId is required" });
  }

  try {
    const { user, redemption } = await redeemReward(agentId, catalogId, io);
    res.status(200).json({
      success: true,
      message: "Reward redeemed successfully!",
      points: user.points,
      unlockedTitles: user.unlockedTitles,
      unlockedThemes: user.unlockedThemes
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @desc    Get point redemption history
 * @route   GET /api/gamification/rewards/history
 * @access  Private (Agent Only)
 */
const getRedemptionHistoryHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const history = await getRedemptionHistory(agentId);
  res.status(200).json({
    success: true,
    history
  });
});

/**
 * @desc    Equip unlocked title
 * @route   POST /api/gamification/rewards/equip-title
 * @access  Private (Agent Only)
 */
const equipTitleHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { title } = req.body;

  try {
    const user = await equipTitle(agentId, title);
    res.status(200).json({
      success: true,
      message: "Title updated successfully!",
      selectedTitle: user.selectedTitle
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @desc    Equip unlocked theme
 * @route   POST /api/gamification/rewards/equip-theme
 * @access  Private (Agent Only)
 */
const equipThemeHandler = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { theme } = req.body;

  try {
    const user = await equipTheme(agentId, theme);
    res.status(200).json({
      success: true,
      message: "Theme updated successfully!",
      selectedTheme: user.selectedTheme
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = {
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
};
