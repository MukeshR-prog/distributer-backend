const Achievement = require('../models/Achievement');
const AgentAchievement = require('../models/AgentAchievement');
const User = require('../models/User');
const Distribution = require('../models/Distribution');
const { logActivity } = require('../utils/activityLogger');
const {
  calculateCompletionMetrics,
  calculateSLAMetrics,
  calculateProductivityScore
} = require('./agentPerformanceEngine');

// Standard master achievements to seed
const DEFAULT_ACHIEVEMENTS = [
  {
    title: "First Blood",
    description: "Successfully complete your first distribution task.",
    category: "completion",
    criteria: { type: "task_completion", threshold: 1 },
    pointsReward: 100,
    badgeIcon: "star",
    difficulty: "easy"
  },
  {
    title: "Task Crusher",
    description: "Complete at least 25 assigned distribution tasks.",
    category: "completion",
    criteria: { type: "task_completion", threshold: 25 },
    pointsReward: 300,
    badgeIcon: "trophy",
    difficulty: "medium"
  },
  {
    title: "SLA Champion",
    description: "Achieve a 95% or higher SLA compliance rate.",
    category: "sla",
    criteria: { type: "sla_compliance", threshold: 95 },
    pointsReward: 400,
    badgeIcon: "shield",
    difficulty: "medium"
  },
  {
    title: "Streak Master",
    description: "Complete tasks on 5 consecutive days.",
    category: "streaks",
    criteria: { type: "streak_count", threshold: 5 },
    pointsReward: 500,
    badgeIcon: "flame",
    difficulty: "hard"
  },
  {
    title: "Productivity Peak",
    description: "Achieve a composite productivity score of 95 or higher.",
    category: "productivity",
    criteria: { type: "productivity_score", threshold: 95 },
    pointsReward: 500,
    badgeIcon: "award",
    difficulty: "hard"
  }
];

// Seed default achievements if they don't exist
const seedAchievements = async () => {
  try {
    for (const ach of DEFAULT_ACHIEVEMENTS) {
      const exists = await Achievement.findOne({ title: ach.title });
      if (!exists) {
        await Achievement.create(ach);
        console.log(`🏆 Seeded master achievement: "${ach.title}"`);
      }
    }
  } catch (error) {
    console.error("⚠️ Failed to seed achievements:", error.message);
  }
};

// Calculate current and longest streaks based on task completion dates
const getAgentStreaks = async (agentId) => {
  const dists = await Distribution.find({ 'agents.agentId': agentId });
  
  // Extract all completed record dates
  const dates = [];
  dists.forEach(d => {
    const agentData = d.agents.find(a => a.agentId.toString() === agentId.toString());
    if (agentData) {
      agentData.records.forEach(r => {
        if (r.status === 'completed' && r.updatedAt) {
          const dStr = new Date(r.updatedAt).toISOString().split('T')[0];
          if (!dates.includes(dStr)) {
            dates.push(dStr);
          }
        }
      });
    }
  });

  if (dates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Sort dates descending
  dates.sort((a, b) => new Date(b) - new Date(a));

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const hasToday = dates.includes(todayStr);
  const hasYesterday = dates.includes(yesterdayStr);

  const streakActive = hasToday || hasYesterday;
  
  // Calculate longest streak ascending
  const sortedDates = [...dates].sort((a, b) => new Date(a) - new Date(b));
  
  let prevDate = null;
  for (const dStr of sortedDates) {
    const curDate = new Date(dStr);
    if (!prevDate) {
      tempStreak = 1;
    } else {
      const diffTime = Math.abs(curDate - prevDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        tempStreak += 1;
      } else if (diffDays > 1) {
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
        }
        tempStreak = 1;
      }
    }
    prevDate = curDate;
  }
  
  if (tempStreak > longestStreak) {
    longestStreak = tempStreak;
  }

  if (streakActive) {
    // Current active streak working backwards
    let checkDate = hasToday ? new Date(todayStr) : new Date(yesterdayStr);
    currentStreak = 0;
    while (true) {
      const checkStr = checkDate.toISOString().split('T')[0];
      if (dates.includes(checkStr)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  } else {
    currentStreak = 0;
  }

  return { currentStreak, longestStreak };
};

// Evaluate streaks, level up checkpoints, points distribution, and achievements criteria
const evaluateAchievements = async (agentId, io = null) => {
  // Ensure achievements are seeded
  await seedAchievements();

  const user = await User.findById(agentId);
  if (!user) return;

  const [completion, sla, prod, streaks] = await Promise.all([
    calculateCompletionMetrics(agentId),
    calculateSLAMetrics(agentId),
    calculateProductivityScore(agentId),
    getAgentStreaks(agentId)
  ]);

  const metrics = {
    completed: completion.completed || 0,
    slaCompliance: sla.slaCompliance || 0,
    productivityScore: prod.score || 0
  };

  // Find unlocked achievements
  let unlockedAchievements = await AgentAchievement.find({ agentId, isUnlocked: true }).populate('achievementId');
  const unlockedIds = new Set(unlockedAchievements.map(ua => ua.achievementId._id.toString()));

  // Unlocked achievements count
  let achievementsXP = unlockedAchievements.length * 200;
  let achievementsPoints = unlockedAchievements.reduce((sum, aa) => sum + (aa.achievementId.pointsReward || 0), 0);

  // Initial stats base XP/Points calculations
  let baseXP = (metrics.completed * 100) + (sla.onTimeCompleted * 50) + achievementsXP;
  let basePoints = (metrics.completed * 50) + (sla.onTimeCompleted * 20) + achievementsPoints;

  // Level thresholds (each level takes 1000 XP)
  let level = Math.floor(baseXP / 1000) + 1;
  const oldLevel = user.level || 1;

  // Check achievements definitions
  const achievementsList = await Achievement.find();
  let newlyUnlockedCount = 0;

  for (const ach of achievementsList) {
    if (unlockedIds.has(ach._id.toString())) {
      continue;
    }

    let currentValue = 0;
    let targetValue = ach.criteria.threshold || 1;
    let shouldUnlock = false;

    switch (ach.criteria.type) {
      case 'task_completion':
        currentValue = metrics.completed;
        shouldUnlock = currentValue >= targetValue;
        break;
      case 'sla_compliance':
        currentValue = metrics.slaCompliance;
        shouldUnlock = metrics.completed >= 5 && currentValue >= targetValue;
        break;
      case 'streak_count':
        currentValue = streaks.longestStreak;
        shouldUnlock = currentValue >= targetValue;
        break;
      case 'productivity_score':
        currentValue = metrics.productivityScore;
        shouldUnlock = currentValue >= targetValue;
        break;
      default:
        break;
    }

    const progressPercent = Math.min(100, Math.round((currentValue / targetValue) * 100));

    let agentAch = await AgentAchievement.findOne({ agentId, achievementId: ach._id });
    if (!agentAch) {
      agentAch = new AgentAchievement({
        agentId,
        achievementId: ach._id,
        currentValue,
        targetValue,
        progressPercent,
        isUnlocked: false
      });
    } else {
      agentAch.currentValue = currentValue;
      agentAch.progressPercent = progressPercent;
    }

    if (shouldUnlock) {
      agentAch.isUnlocked = true;
      agentAch.unlockedAt = new Date();
      agentAch.progressPercent = 100;
      await agentAch.save();

      newlyUnlockedCount++;
      baseXP += 200; // Unlock bonus
      basePoints += ach.pointsReward;

      // Log activity event
      await logActivity({
        actionType: 'ACHIEVEMENT_UNLOCKED',
        entityType: 'User',
        entityId: agentId,
        userId: agentId,
        metadata: {
          achievementId: ach._id,
          achievementTitle: ach.title,
          badgeIcon: ach.badgeIcon,
          pointsReward: ach.pointsReward
        }
      }, io);

      // Socket announcement
      if (io) {
        io.emit('achievementUnlocked', {
          agentId,
          achievementTitle: ach.title,
          badgeIcon: ach.badgeIcon,
          pointsReward: ach.pointsReward
        });
      }
    } else {
      await agentAch.save();
    }
  }

  // Recalculate level after potential unlocks
  level = Math.floor(baseXP / 1000) + 1;

  user.xp = baseXP;
  user.points = basePoints;
  user.currentStreak = streaks.currentStreak;
  user.longestStreak = streaks.longestStreak;

  if (level > oldLevel) {
    user.level = level;
    await user.save({ validateBeforeSave: false });

    // Log level up activity event
    await logActivity({
      actionType: 'LEVEL_UP',
      entityType: 'User',
      entityId: agentId,
      userId: agentId,
      metadata: {
        oldLevel,
        newLevel: level,
        pointsAwarded: (level - oldLevel) * 200
      }
    }, io);

    if (io) {
      io.emit('levelUp', {
        agentId,
        oldLevel,
        newLevel: level
      });
    }
  } else {
    await user.save({ validateBeforeSave: false });
  }

  return {
    xp: baseXP,
    points: basePoints,
    level,
    streaks
  };
};

module.exports = {
  seedAchievements,
  getAgentStreaks,
  evaluateAchievements
};
