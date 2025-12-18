const RewardCatalog = require('../models/RewardCatalog');
const RewardRedemption = require('../models/RewardRedemption');
const User = require('../models/User');
const { logActivity } = require('../utils/activityLogger');

const DEFAULT_REWARDS = [
  {
    title: "Distribution Expert",
    description: "Equippable title displaying your mastery in queue distributions.",
    costPoints: 200,
    itemType: "title"
  },
  {
    title: "SLA Ninja",
    description: "Equippable title showcasing your quick response times.",
    costPoints: 400,
    itemType: "title"
  },
  {
    title: "Grand Master",
    description: "Premium prestige title representing ultimate performance status.",
    costPoints: 1000,
    itemType: "title"
  },
  {
    title: "Emerald Glass Theme",
    description: "Apply a premium glassmorphic emerald design system to your achievements tab.",
    costPoints: 300,
    itemType: "theme",
    themeColor: "emerald"
  },
  {
    title: "Midnight Indigo Theme",
    description: "Apply a premium deep indigo neon outline to your dashboard cards.",
    costPoints: 500,
    itemType: "theme",
    themeColor: "indigo"
  },
  {
    title: "Cyber Neon Theme",
    description: "Apply a high-tech pink fuchsia futuristic styling scheme.",
    costPoints: 800,
    itemType: "theme",
    themeColor: "fuchsia"
  },
  {
    title: "Elite Medal Badge",
    description: "An unlockable profile ribbon shown next to your name.",
    costPoints: 150,
    itemType: "badge",
    badgeIcon: "award"
  },
  {
    title: "SLA Golden Shield Badge",
    description: "An unlockable profile icon celebrating SLA perfection.",
    costPoints: 350,
    itemType: "badge",
    badgeIcon: "shield"
  }
];

// Seed rewards catalog if empty
const seedRewards = async () => {
  try {
    for (const r of DEFAULT_REWARDS) {
      const exists = await RewardCatalog.findOne({ title: r.title });
      if (!exists) {
        await RewardCatalog.create(r);
        console.log(`🎁 Seeded reward catalog item: "${r.title}"`);
      }
    }
  } catch (error) {
    console.error("⚠️ Failed to seed rewards catalog:", error.message);
  }
};

// Redeem a catalog item using user points
const redeemReward = async (agentId, catalogId, io = null) => {
  await seedRewards();

  const user = await User.findById(agentId);
  if (!user) {
    throw new Error("Agent user not found");
  }

  const reward = await RewardCatalog.findById(catalogId);
  if (!reward) {
    throw new Error("Reward catalog item not found");
  }

  // Deduct points validation
  if (user.points < reward.costPoints) {
    throw new Error(`Insufficient points. You need ${reward.costPoints} points, but only have ${user.points}.`);
  }

  // Duplicate checks
  if (reward.itemType === 'title' && user.unlockedTitles.includes(reward.title)) {
    throw new Error("You have already unlocked this title.");
  }
  if (reward.itemType === 'theme' && user.unlockedThemes.includes(reward.title)) {
    throw new Error("You have already unlocked this theme.");
  }

  // Deduct points & save unlocks
  user.points -= reward.costPoints;
  if (reward.itemType === 'title') {
    user.unlockedTitles.push(reward.title);
  } else if (reward.itemType === 'theme') {
    user.unlockedThemes.push(reward.title);
  }

  await user.save({ validateBeforeSave: false });

  // Create redemption record
  const redemption = await RewardRedemption.create({
    agentId,
    rewardId: catalogId,
    pointsSpent: reward.costPoints
  });

  // Log activity
  await logActivity({
    actionType: 'REWARD_REDEEMED',
    entityType: 'User',
    entityId: agentId,
    userId: agentId,
    metadata: {
      rewardId: reward._id,
      rewardTitle: reward.title,
      costPoints: reward.costPoints,
      itemType: reward.itemType
    }
  }, io);

  if (io) {
    io.emit('rewardRedeemed', {
      agentId,
      rewardTitle: reward.title,
      costPoints: reward.costPoints,
      itemType: reward.itemType
    });
  }

  return {
    user,
    redemption
  };
};

// Equip an unlocked title
const equipTitle = async (agentId, title) => {
  const user = await User.findById(agentId);
  if (!user) throw new Error("Agent user not found");

  if (title && !user.unlockedTitles.includes(title)) {
    throw new Error("This title is not unlocked yet.");
  }

  user.selectedTitle = title || "";
  await user.save({ validateBeforeSave: false });
  return user;
};

// Equip an unlocked theme
const equipTheme = async (agentId, theme) => {
  const user = await User.findById(agentId);
  if (!user) throw new Error("Agent user not found");

  if (theme && !user.unlockedThemes.includes(theme)) {
    throw new Error("This theme is not unlocked yet.");
  }

  user.selectedTheme = theme || "";
  await user.save({ validateBeforeSave: false });
  return user;
};

// Fetch redemptions list
const getRedemptionHistory = async (agentId) => {
  return RewardRedemption.find({ agentId })
    .populate('rewardId')
    .sort({ redeemedAt: -1 });
};

module.exports = {
  seedRewards,
  redeemReward,
  equipTitle,
  equipTheme,
  getRedemptionHistory
};
