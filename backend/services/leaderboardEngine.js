const User = require('../models/User');
const Distribution = require('../models/Distribution');
const ActivityLog = require('../models/ActivityLog');
const LeaderboardSeason = require('../models/LeaderboardSeason');
const { logActivity } = require('../utils/activityLogger');

// Helper to fetch all records assigned to agents
const fetchAllRecords = async () => {
  const distributions = await Distribution.find({});
  const records = [];
  distributions.forEach(dist => {
    if (dist.agents) {
      dist.agents.forEach(agentData => {
        if (agentData.records) {
          agentData.records.forEach(r => {
            records.push({
              ...r.toObject ? r.toObject() : JSON.parse(JSON.stringify(r)),
              agentId: agentData.agentId.toString(),
              distributionId: dist._id
            });
          });
        }
      });
    }
  });
  return records;
};

// Calculate scoreboard for a specific date range
const getPeriodLeaderboard = async (startDate, endDate) => {
  const agents = await User.find({ role: 'agent', isActive: true });
  const allRecords = await fetchAllRecords();
  
  // Filter activities in date range
  const activities = await ActivityLog.find({
    createdAt: { $gte: startDate, $lte: endDate }
  });
  
  // Group activities by agent
  const activityMap = {};
  activities.forEach(act => {
    if (act.performedBy) {
      const aId = act.performedBy.toString();
      activityMap[aId] = (activityMap[aId] || 0) + 1;
    }
  });

  const startTime = startDate.getTime();
  const endTime = endDate.getTime();

  const leaderboard = agents.map(agent => {
    const agentIdStr = agent._id.toString();
    
    // Filter records assigned / completed in this period
    const agentRecords = allRecords.filter(r => r.agentId === agentIdStr);
    
    const assignedInPeriod = agentRecords.filter(r => {
      const assignedTime = new Date(r.assignedAt).getTime();
      return assignedTime >= startTime && assignedTime <= endTime;
    });
    
    const completedInPeriod = agentRecords.filter(r => {
      if (r.status !== 'completed') return false;
      const completedTime = new Date(r.completedAt || r.updatedAt).getTime();
      return completedTime >= startTime && completedTime <= endTime;
    });

    const completionRate = assignedInPeriod.length > 0
      ? Math.round((completedInPeriod.length / assignedInPeriod.length) * 100)
      : 0;

    let onTime = 0;
    completedInPeriod.forEach(r => {
      if (!r.dueDate) {
        onTime++;
      } else {
        const completedTime = new Date(r.completedAt || r.updatedAt).getTime();
        const dueTime = new Date(r.dueDate).getTime();
        if (completedTime <= dueTime) {
          onTime++;
        }
      }
    });
    const slaCompliance = completedInPeriod.length > 0
      ? Math.round((onTime / completedInPeriod.length) * 100)
      : 100;

    const activityCount = activityMap[agentIdStr] || 0;
    const activityParticipation = Math.min(Math.round((activityCount / 7) * 100), 100); // Benchmark: 7 actions/week

    let resolutionSpeedScore = 100;
    const completedWithTimes = completedInPeriod.filter(r => r.assignedAt && (r.completedAt || r.updatedAt));
    if (completedWithTimes.length > 0) {
      let totalHours = 0;
      completedWithTimes.forEach(r => {
        const assignedTime = new Date(r.assignedAt).getTime();
        const completedTime = new Date(r.completedAt || r.updatedAt).getTime();
        totalHours += (completedTime - assignedTime) / (1000 * 60 * 60);
      });
      const avgRes = totalHours / completedWithTimes.length;
      if (avgRes <= 2) resolutionSpeedScore = 100;
      else if (avgRes <= 6) resolutionSpeedScore = 90;
      else if (avgRes <= 12) resolutionSpeedScore = 80;
      else if (avgRes <= 24) resolutionSpeedScore = 70;
      else if (avgRes <= 48) resolutionSpeedScore = 50;
      else resolutionSpeedScore = 30;
    }

    const productivityScore = Math.round(
      (completionRate * 0.40) +
      (slaCompliance * 0.35) +
      (activityParticipation * 0.15) +
      (resolutionSpeedScore * 0.10)
    );

    const compositeScore = productivityScore + completionRate + slaCompliance;

    return {
      agentId: agent._id,
      name: agent.name,
      email: agent.email,
      profileImage: agent.profileImage,
      selectedTitle: agent.selectedTitle || '',
      selectedTheme: agent.selectedTheme || '',
      level: agent.level,
      points: agent.points,
      currentStreak: agent.currentStreak,
      productivityScore,
      completionRate,
      slaCompliance,
      compositeScore
    };
  });

  leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);

  return leaderboard.map((item, index) => ({
    ...item,
    rank: index + 1
  }));
};

// Retrieve or create current season
const getCurrentSeason = async () => {
  const now = new Date();
  const seasonName = `Season ${now.toLocaleString('default', { month: 'long' })} ${now.getFullYear()}`;
  
  let season = await LeaderboardSeason.findOne({ seasonName });
  if (!season) {
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    
    season = new LeaderboardSeason({
      seasonName,
      startDate,
      endDate,
      topPerformers: [],
      rewards: [
        { rank: 1, pointsReward: 1000 },
        { rank: 2, pointsReward: 500 },
        { rank: 3, pointsReward: 250 }
      ]
    });
    await season.save();
  }
  return season;
};

// Close season and reward users if season is past and rewards not yet distributed
const checkAndClosePastSeasons = async (io = null) => {
  const now = new Date();
  const pastUnclosedSeasons = await LeaderboardSeason.find({
    endDate: { $lt: now },
    topPerformers: { $size: 0 }
  });

  for (const season of pastUnclosedSeasons) {
    const standings = await getPeriodLeaderboard(season.startDate, season.endDate);
    if (standings.length === 0) continue;

    const topPerformers = standings.slice(0, 3).map(s => ({
      agentId: s.agentId,
      rank: s.rank,
      score: s.compositeScore
    }));

    season.topPerformers = topPerformers;
    await season.save();

    // Reward the top performers
    for (const performer of topPerformers) {
      const user = await User.findById(performer.agentId);
      if (!user) continue;

      const rewardConfig = season.rewards.find(r => r.rank === performer.rank);
      if (rewardConfig) {
        user.points += rewardConfig.pointsReward;
        await user.save({ validateBeforeSave: false });

        // Log Leaderboard Winner Activity
        await logActivity({
          actionType: 'LEADERBOARD_WINNER',
          entityType: 'User',
          entityId: performer.agentId,
          userId: performer.agentId,
          metadata: {
            seasonName: season.seasonName,
            rank: performer.rank,
            score: performer.score,
            pointsReward: rewardConfig.pointsReward
          }
        }, io);

        if (io) {
          io.emit('leaderboardWinner', {
            agentId: performer.agentId,
            seasonName: season.seasonName,
            rank: performer.rank,
            pointsReward: rewardConfig.pointsReward
          });
        }
      }
    }
  }
};

const getWeeklyLeaderboard = async () => {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return getPeriodLeaderboard(start, now);
};

const getMonthlyLeaderboard = async () => {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return getPeriodLeaderboard(start, now);
};

const getAllTimeLeaderboard = async () => {
  const agents = await User.find({ role: 'agent', isActive: true });
  const sorted = agents.map(agent => ({
    agentId: agent._id,
    name: agent.name,
    email: agent.email,
    profileImage: agent.profileImage,
    selectedTitle: agent.selectedTitle || '',
    selectedTheme: agent.selectedTheme || '',
    level: agent.level,
    points: agent.points,
    currentStreak: agent.currentStreak,
    productivityScore: 100, // Placeholder for all time
    completionRate: agent.completionRate || 0,
    slaCompliance: 100, // Baseline placeholder
    compositeScore: agent.level * 1000 + agent.points
  }));

  sorted.sort((a, b) => b.compositeScore - a.compositeScore);
  return sorted.map((item, index) => ({
    ...item,
    rank: index + 1
  }));
};

module.exports = {
  getCurrentSeason,
  checkAndClosePastSeasons,
  getPeriodLeaderboard,
  getWeeklyLeaderboard,
  getMonthlyLeaderboard,
  getAllTimeLeaderboard
};
