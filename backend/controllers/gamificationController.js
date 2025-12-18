const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Achievement = require('../models/Achievement');
const AgentAchievement = require('../models/AgentAchievement');
const { evaluateAchievements } = require('../services/achievementEngine');

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
    xpNextLevel: 1000
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

module.exports = {
  getGamificationProfile,
  getAgentAchievements,
  getRewardsTimeline
};
