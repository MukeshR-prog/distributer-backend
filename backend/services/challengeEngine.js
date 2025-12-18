const Challenge = require('../models/Challenge');
const AgentChallenge = require('../models/AgentChallenge');
const User = require('../models/User');
const Distribution = require('../models/Distribution');
const { logActivity } = require('../utils/activityLogger');

const DEFAULT_CHALLENGES = [
  {
    title: "Daily Task Crusher",
    description: "Complete at least 5 assigned tasks today.",
    type: "daily",
    targetType: "task_completion",
    threshold: 5,
    xpReward: 100,
    pointsReward: 50
  },
  {
    title: "Daily SLA Shield",
    description: "Maintain 100% SLA compliance today (minimum 2 tasks completed).",
    type: "daily",
    targetType: "sla_compliance",
    threshold: 100,
    xpReward: 120,
    pointsReward: 60
  },
  {
    title: "Daily Critical Responder",
    description: "Resolve at least 1 critical priority task today.",
    type: "daily",
    targetType: "critical_resolution",
    threshold: 1,
    xpReward: 150,
    pointsReward: 75
  },
  {
    title: "Weekly Task Titan",
    description: "Complete at least 20 assigned tasks this week.",
    type: "weekly",
    targetType: "task_completion",
    threshold: 20,
    xpReward: 500,
    pointsReward: 250
  },
  {
    title: "Weekly SLA Master",
    description: "Maintain 95% or higher SLA compliance this week (minimum 5 tasks completed).",
    type: "weekly",
    targetType: "sla_compliance",
    threshold: 95,
    xpReward: 600,
    pointsReward: 300
  },
  {
    title: "Weekly Critical Defender",
    description: "Resolve at least 5 critical priority tasks this week.",
    type: "weekly",
    targetType: "critical_resolution",
    threshold: 5,
    xpReward: 700,
    pointsReward: 350
  }
];

// Seed challenges if they don't exist
const seedChallenges = async () => {
  try {
    for (const chal of DEFAULT_CHALLENGES) {
      const exists = await Challenge.findOne({ title: chal.title });
      if (!exists) {
        await Challenge.create(chal);
        console.log(`🎯 Seeded challenge: "${chal.title}"`);
      }
    }
  } catch (error) {
    console.error("⚠️ Failed to seed challenges:", error.message);
  }
};

const isSameDay = (d1, d2) => {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
};

const isSameWeek = (d1, d2) => {
  // Get start of week (Sunday) for both dates
  const getStartOfWeek = (d) => {
    const temp = new Date(d);
    const day = temp.getDay();
    const diff = temp.getDate() - day;
    return new Date(temp.setDate(diff));
  };
  return isSameDay(getStartOfWeek(d1), getStartOfWeek(d2));
};

// Fetch agent records from distributions
const fetchAgentRecords = async (agentId) => {
  const distributions = await Distribution.find({
    'agents.agentId': agentId
  });

  const records = [];
  distributions.forEach(dist => {
    const agentData = dist.agents.find(a => a.agentId.toString() === agentId.toString());
    if (agentData && agentData.records) {
      agentData.records.forEach(r => {
        records.push({
          ...r.toObject ? r.toObject() : JSON.parse(JSON.stringify(r)),
          distributionId: dist._id,
          distributionName: dist.fileName
        });
      });
    }
  });
  return records;
};

// Evaluate challenges for an agent
const evaluateChallenges = async (agentId, io = null) => {
  await seedChallenges();

  const user = await User.findById(agentId);
  if (!user) return [];

  const records = await fetchAgentRecords(agentId);
  const now = new Date();

  // Filter records completed today vs this week
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const startOfWeek = new Date();
  const day = startOfWeek.getDay();
  const diff = startOfWeek.getDate() - day;
  startOfWeek.setDate(diff);
  startOfWeek.setHours(0, 0, 0, 0);

  const completedToday = records.filter(r => {
    if (r.status !== 'completed') return false;
    const completedDate = new Date(r.completedAt || r.updatedAt);
    return completedDate >= startOfToday;
  });

  const completedThisWeek = records.filter(r => {
    if (r.status !== 'completed') return false;
    const completedDate = new Date(r.completedAt || r.updatedAt);
    return completedDate >= startOfWeek;
  });

  const challengesList = await Challenge.find();
  const results = [];

  for (const chal of challengesList) {
    let agentChal = await AgentChallenge.findOne({ agentId, challengeId: chal._id });
    
    // Check for resets based on type (daily or weekly)
    if (agentChal) {
      const lastUpdated = new Date(agentChal.updatedAt);
      let needsReset = false;
      if (chal.type === 'daily' && !isSameDay(now, lastUpdated)) {
        needsReset = true;
      } else if (chal.type === 'weekly' && !isSameWeek(now, lastUpdated)) {
        needsReset = true;
      }

      if (needsReset) {
        agentChal.currentValue = 0;
        agentChal.isCompleted = false;
        agentChal.completedAt = null;
        await agentChal.save();
      }
    }

    // Calculate current progress
    let currentValue = 0;
    const relevantRecords = chal.type === 'daily' ? completedToday : completedThisWeek;

    if (chal.targetType === 'task_completion') {
      currentValue = relevantRecords.length;
    } else if (chal.targetType === 'critical_resolution') {
      currentValue = relevantRecords.filter(r => {
        const priority = (r.priority || '').toLowerCase();
        return priority === 'critical';
      }).length;
    } else if (chal.targetType === 'sla_compliance') {
      const minTasks = chal.type === 'daily' ? 2 : 5;
      if (relevantRecords.length >= minTasks) {
        let onTime = 0;
        relevantRecords.forEach(r => {
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
        currentValue = Math.round((onTime / relevantRecords.length) * 100);
      } else {
        currentValue = 0; // Not enough tasks resolved yet
      }
    }

    let isNewlyCompleted = false;
    let shouldUnlock = currentValue >= chal.threshold;

    if (chal.targetType === 'sla_compliance' && chal.type === 'daily' && completedToday.length < 2) {
      shouldUnlock = false;
    }
    if (chal.targetType === 'sla_compliance' && chal.type === 'weekly' && completedThisWeek.length < 5) {
      shouldUnlock = false;
    }

    if (!agentChal) {
      agentChal = new AgentChallenge({
        agentId,
        challengeId: chal._id,
        currentValue,
        targetValue: chal.threshold,
        isCompleted: shouldUnlock,
        completedAt: shouldUnlock ? new Date() : null
      });
      isNewlyCompleted = shouldUnlock;
    } else {
      // If it wasn't completed, check if it is completed now
      if (!agentChal.isCompleted && shouldUnlock) {
        agentChal.isCompleted = true;
        agentChal.completedAt = new Date();
        isNewlyCompleted = true;
      }
      agentChal.currentValue = currentValue;
    }

    await agentChal.save();

    if (isNewlyCompleted) {
      // Distribute rewards and log/emit
      const oldLevel = user.level || 1;
      user.xp += chal.xpReward;
      user.points += chal.pointsReward;

      const newLevel = Math.floor(user.xp / 1000) + 1;
      if (newLevel > oldLevel) {
        user.level = newLevel;
        await logActivity({
          actionType: 'LEVEL_UP',
          entityType: 'User',
          entityId: agentId,
          userId: agentId,
          metadata: {
            oldLevel,
            newLevel,
            pointsAwarded: (newLevel - oldLevel) * 200
          }
        }, io);

        if (io) {
          io.emit('levelUp', {
            agentId,
            oldLevel,
            newLevel
          });
        }
      }

      await user.save({ validateBeforeSave: false });

      await logActivity({
        actionType: 'CHALLENGE_COMPLETED',
        entityType: 'User',
        entityId: agentId,
        userId: agentId,
        metadata: {
          challengeId: chal._id,
          challengeTitle: chal.title,
          xpReward: chal.xpReward,
          pointsReward: chal.pointsReward
        }
      }, io);

      if (io) {
        io.emit('challengeCompleted', {
          agentId,
          challengeTitle: chal.title,
          xpReward: chal.xpReward,
          pointsReward: chal.pointsReward
        });
      }
    }

    results.push({
      challenge: chal,
      progress: agentChal
    });
  }

  return results;
};

module.exports = {
  seedChallenges,
  evaluateChallenges
};
