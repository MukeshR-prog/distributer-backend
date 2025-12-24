const CareerProgressionSnapshot = require('../models/CareerProgressionSnapshot');
const User = require('../models/User');
const Achievement = require('../models/Achievement');
const AgentAchievement = require('../models/AgentAchievement');
const ChannelMessage = require('../models/ChannelMessage');
const TaskDiscussion = require('../models/TaskDiscussion');
const Certification = require('../models/Certification');
const CoachingAction = require('../models/CoachingAction');
const AgentCoachingSnapshot = require('../models/AgentCoachingSnapshot');
const LearningPath = require('../models/LearningPath');
const { callGroq } = require('./groqService');
const { logActivity } = require('../utils/activityLogger');
const {
  calculateProductivityScore,
  calculateSLAMetrics
} = require('./agentPerformanceEngine');
const { calculateAgentCareerStats } = require('./careerGrowthEngine');

const SYSTEM_PROMPT = `You are a Career progression and executive coach AI for a distribution operations center.
Based on the agent's current role, target role, readiness score, performance metrics, strengths, weaknesses, completed/pending checklists, recommend a structured career progression plan.
Your response MUST be a single, valid JSON object matching the JSON schema below:
{
  "strengths": ["string"],
  "improvementAreas": ["string"],
  "missingSkills": ["string"],
  "recommendedCertifications": ["string"],
  "leadershipGoals": ["string"],
  "weeklyImprovementPlan": [
    { "week": 1, "action": "string" },
    { "week": 2, "action": "string" },
    { "week": 3, "action": "string" },
    { "week": 4, "action": "string" }
  ]
}
Ensure the output is pure JSON. Do not include any markdown, explanation wrappers, or extra text.`;

/**
 * Gets a static local rules-based career roadmap if LLM calls fail.
 */
const getFallbackRoadmap = (currentRole, targetRole, readinessScore, completedReqs, pendingReqs, productivity, sla, completedPathsCount) => {
  const strengths = [];
  if (productivity >= 80) strengths.push("Consistent operational productivity output");
  if (sla >= 90) strengths.push("Excellent track record of meeting SLA deadlines");
  if (completedPathsCount > 0) strengths.push("Proactive completion of training certifications");
  if (strengths.length === 0) strengths.push("Reliable core queue performance and ticket handling");

  const improvementAreas = [];
  if (sla < 85) improvementAreas.push("Improve task resolution timeline adherence");
  if (productivity < 80) improvementAreas.push("Boost total volume of processed distribution items");
  if (completedPathsCount === 0) improvementAreas.push("Begin path courses in the Learning Center");
  if (improvementAreas.length === 0) improvementAreas.push("Mentor junior colleagues on queue optimizations");

  const missingSkills = [];
  const recommendedCertifications = [];
  if (sla < 85) {
    missingSkills.push("SLA Breach Prevention");
    recommendedCertifications.push("SLA Excellence");
  }
  if (productivity < 80) {
    missingSkills.push("Time and Queue Management");
    recommendedCertifications.push("Productivity Optimization");
  }
  if (missingSkills.length === 0) {
    missingSkills.push("Leadership and Escalation Coordination");
    recommendedCertifications.push("Leadership Skills");
  }

  const weeklyImprovementPlan = [
    {
      week: 1,
      action: `Register for and begin the "${recommendedCertifications[0] || 'Customer Communication'}" training path`
    },
    {
      week: 2,
      action: "Review unresolved queue items daily and filter by highest critical priority"
    },
    {
      week: 3,
      action: "Collaborate in general channels or task discussion replies to resolve operational hurdles"
    },
    {
      week: 4,
      action: "Complete all final exams for the active certification course and maintain consistent daily streaks"
    }
  ];

  return {
    strengths,
    improvementAreas,
    missingSkills,
    recommendedCertifications,
    leadershipGoals: [
      `Complete prerequisites to qualify for promotion to ${targetRole}`,
      "Maintain streak metrics above the daily target standard"
    ],
    weeklyImprovementPlan
  };
};

/**
 * Evaluates requirements metrics against a target role.
 */
const evaluateRequirements = (currentTier, completedPathsCount, productivityScore, userLevel) => {
  let targetTier = 'Professional Agent';
  let pathReq = 1;
  let prodReq = 75;
  let levelReq = 1;

  if (currentTier === 'Professional Agent') {
    targetTier = 'Senior Agent';
    pathReq = 2;
    prodReq = 80;
  } else if (currentTier === 'Senior Agent') {
    targetTier = 'Lead Agent';
    pathReq = 3;
    prodReq = 85;
    levelReq = 5;
  } else if (currentTier === 'Lead Agent') {
    targetTier = 'Operations Specialist';
    pathReq = 4;
    prodReq = 90;
    levelReq = 10;
  } else if (currentTier === 'Operations Specialist' || currentTier === 'Operations Expert') {
    targetTier = 'Operations Expert';
    pathReq = 6;
    prodReq = 95;
    levelReq = 15;
  }

  const completed = [];
  const pending = [];

  if (completedPathsCount >= pathReq) {
    completed.push(`Complete at least ${pathReq} Learning Path certification(s) (${completedPathsCount}/${pathReq})`);
  } else {
    pending.push(`Complete at least ${pathReq} Learning Path certification(s) (${completedPathsCount}/${pathReq})`);
  }

  if (productivityScore >= prodReq) {
    completed.push(`Maintain Productivity Score >= ${prodReq} (Current: ${productivityScore})`);
  } else {
    pending.push(`Maintain Productivity Score >= ${prodReq} (Current: ${productivityScore})`);
  }

  if (levelReq > 1) {
    if (userLevel >= levelReq) {
      completed.push(`Reach User Level >= ${levelReq} (Current: ${userLevel})`);
    } else {
      pending.push(`Reach User Level >= ${levelReq} (Current: ${userLevel})`);
    }
  }

  return {
    targetTier,
    completed,
    pending
  };
};

/**
 * Calculates promotion readiness score and level.
 */
const calculatePromotionReadiness = async (agentId) => {
  try {
    const [prodResult, careerStats, user] = await Promise.all([
      calculateProductivityScore(agentId),
      calculateAgentCareerStats(agentId),
      User.findById(agentId)
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const productivity = prodResult.score || 0;
    const learningCompletion = careerStats.skillScore || 0;

    // Achievements calculation
    const totalAchievementsCount = await Achievement.countDocuments();
    const unlockedAchievementsCount = await AgentAchievement.countDocuments({ agentId, isUnlocked: true });
    const achievements = totalAchievementsCount > 0 ? Math.round((unlockedAchievementsCount / totalAchievementsCount) * 100) : 100;

    // Collaboration calculation
    const [messageCount, discussionCount, replyCount] = await Promise.all([
      ChannelMessage.countDocuments({ sender: agentId }),
      TaskDiscussion.countDocuments({ sender: agentId }),
      TaskDiscussion.countDocuments({ 'replies.sender': agentId })
    ]);
    const totalCollabActions = messageCount + discussionCount + replyCount;
    const collaboration = Math.min(Math.round((totalCollabActions / 20) * 100), 100);

    // SLA Compliance
    const slaResult = await calculateSLAMetrics(agentId);
    const slaCompliance = slaResult.slaCompliance || 0;

    // Coaching Progress
    const totalActions = await CoachingAction.countDocuments({ agentId });
    const completedActions = await CoachingAction.countDocuments({ agentId, status: 'completed' });
    let coachingProgress = 100;

    if (totalActions > 0) {
      coachingProgress = Math.round((completedActions / totalActions) * 100);
    } else {
      const snapshot = await AgentCoachingSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });
      if (snapshot) {
        const W = snapshot.weaknesses?.length || 0;
        coachingProgress = Math.max(100 - (W * 10), 50);
      } else {
        coachingProgress = 80;
      }
    }

    const readinessScore = Math.round(
      (productivity * 0.25) +
      (learningCompletion * 0.20) +
      (achievements * 0.15) +
      (collaboration * 0.10) +
      (slaCompliance * 0.15) +
      (coachingProgress * 0.15)
    );

    let readinessLevel = 'Emerging Talent';
    if (readinessScore >= 80) readinessLevel = 'High Potential';
    else if (readinessScore >= 60) readinessLevel = 'Promotion Ready';
    else if (readinessScore >= 40) readinessLevel = 'Developing';

    return {
      readinessScore,
      readinessLevel,
      productivity,
      slaCompliance,
      careerStats,
      user
    };
  } catch (error) {
    console.error('Error in calculatePromotionReadiness:', error.message);
    throw error;
  }
};

/**
 * Generates and saves a career roadmap snapshot.
 */
const generateCareerRoadmap = async (agentId, force = false, io = null) => {
  try {
    if (!force) {
      const activeSnapshot = await CareerProgressionSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });
      // If snapshot is less than 1 day old, return it
      if (activeSnapshot && (Date.now() - new Date(activeSnapshot.generatedAt).getTime()) < 24 * 60 * 60 * 1000) {
        return activeSnapshot;
      }
    }

    const {
      readinessScore,
      readinessLevel,
      productivity,
      slaCompliance,
      careerStats,
      user
    } = await calculatePromotionReadiness(agentId);

    const completedPathsCount = await Certification.countDocuments({ agentId });
    const currentRole = careerStats.careerLevel || 'Associate Agent';

    const { targetTier, completed, pending } = evaluateRequirements(
      currentRole,
      completedPathsCount,
      productivity,
      user.level || 1
    );

    const coachingSnapshot = await AgentCoachingSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });

    const contextPayload = {
      agentName: user.name,
      currentRole,
      targetRole: targetTier,
      readinessScore,
      readinessLevel,
      productivity,
      slaCompliance,
      completedPathsCount,
      completedRequirements: completed,
      pendingRequirements: pending,
      coachingWeaknesses: coachingSnapshot?.weaknesses || []
    };

    let roadmapData;
    let source = 'ai';

    try {
      const userPrompt = `Progression Context: ${JSON.stringify(contextPayload)}`;
      const aiResponse = await callGroq(SYSTEM_PROMPT, userPrompt);
      if (aiResponse && Array.isArray(aiResponse.strengths) && Array.isArray(aiResponse.weeklyImprovementPlan)) {
        roadmapData = aiResponse;
      } else {
        throw new Error('Malformed AI progression payload');
      }
    } catch (err) {
      console.warn(`[CareerEngine] AI promotion planning failed, falling back to rule base: ${err.message}`);
      roadmapData = getFallbackRoadmap(currentRole, targetTier, readinessScore, completed, pending, productivity, slaCompliance, completedPathsCount);
      source = 'fallback';
    }

    // Estimate promotion date
    let weeks = 16;
    if (readinessScore >= 80) weeks = 2;
    else if (readinessScore >= 60) weeks = 4;
    else if (readinessScore >= 40) weeks = 8;
    const estimatedPromotionDate = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000);

    const newSnapshot = await CareerProgressionSnapshot.create({
      agentId,
      readinessScore,
      readinessLevel,
      currentRole,
      nextRole: targetTier,
      strengths: roadmapData.strengths,
      improvementAreas: roadmapData.improvementAreas,
      completedRequirements: completed,
      pendingRequirements: pending,
      missingSkills: roadmapData.missingSkills,
      recommendedCertifications: roadmapData.recommendedCertifications,
      leadershipGoals: roadmapData.leadershipGoals,
      weeklyImprovementPlan: roadmapData.weeklyImprovementPlan,
      estimatedPromotionDate
    });

    await logActivity({
      actionType: 'PROMOTION_SNAPSHOT_GENERATED',
      entityType: 'User',
      entityId: agentId,
      userId: agentId,
      metadata: { snapshotId: newSnapshot._id, readinessScore, source }
    }, io);

    return newSnapshot;
  } catch (error) {
    console.error('Error in generateCareerRoadmap:', error.message);
    throw error;
  }
};

module.exports = {
  calculatePromotionReadiness,
  generateCareerRoadmap
};
