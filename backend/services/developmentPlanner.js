const DevelopmentPlan = require('../models/DevelopmentPlan');
const User = require('../models/User');
const AgentCoachingSnapshot = require('../models/AgentCoachingSnapshot');
const Certification = require('../models/Certification');
const { callGroq } = require('./groqService');
const { logActivity } = require('../utils/activityLogger');
const {
  calculateProductivityScore,
  calculateSLAMetrics,
  calculateAgentRanking
} = require('./agentPerformanceEngine');
const { calculateAgentCareerStats } = require('./careerGrowthEngine');

const SYSTEM_PROMPT = `You are a Career Development Planner AI for a Distribution Management System.
Given the agent's performance metrics, achievements, coaching feedback, learning progress, certifications, and career stats, generate a highly personalized, structured 4-week Development Plan.
Your response MUST be a single, valid JSON object matching the JSON schema below:
{
  "currentLevel": "string",
  "targetLevel": "string",
  "recommendedSkills": ["string"],
  "recommendedCourses": ["string"],
  "estimatedCompletionWeeks": 4,
  "milestones": [
    {
      "week": 1,
      "goals": ["string"],
      "status": "string" // 'in-progress'
    },
    {
      "week": 2,
      "goals": ["string"],
      "status": "string" // 'upcoming'
    },
    {
      "week": 3,
      "goals": ["string"],
      "status": "string" // 'upcoming'
    },
    {
      "week": 4,
      "goals": ["string"],
      "status": "string" // 'upcoming'
    }
  ],
  "strengths": ["string"],
  "skillGaps": ["string"],
  "careerSuggestions": ["string"]
}
Ensure the output is pure JSON. Do not include any markdown, explanation wrappers, or extra text.`;

const getFallbackPlan = (careerLevel, productivity, sla, rank, level, coaching, completedPathsCount) => {
  let targetLevel = "Professional Agent";
  if (careerLevel === "Associate Agent") targetLevel = "Professional Agent";
  else if (careerLevel === "Professional Agent") targetLevel = "Senior Agent";
  else if (careerLevel === "Senior Agent") targetLevel = "Lead Agent";
  else if (careerLevel === "Lead Agent") targetLevel = "Operations Specialist";
  else if (careerLevel === "Operations Specialist") targetLevel = "Operations Expert";
  else if (careerLevel === "Operations Expert") targetLevel = "Operations Expert";

  const strengths = [];
  if (productivity >= 80) strengths.push("Strong composite productivity rating");
  if (sla >= 90) strengths.push("Highly consistent SLA compliance rate");
  if (completedPathsCount > 0) strengths.push("Active participation in Learning Paths");
  if (strengths.length === 0) strengths.push("Maintained basic operational queue requirements");

  const skillGaps = [];
  const recommendedCourses = [];
  const recommendedSkills = [];

  if (sla < 80) {
    skillGaps.push("SLA Compliance tracking issues");
    recommendedCourses.push("SLA Excellence");
    recommendedSkills.push("SLA Rescue Procedures");
  }
  if (productivity < 75) {
    skillGaps.push("Workplace productivity output gaps");
    recommendedCourses.push("Productivity Optimization");
    recommendedSkills.push("Streak Habit Building");
  }
  
  const coachingWeaknesses = coaching?.weaknesses || [];
  const hasCommWeak = coachingWeaknesses.some(w => String(w).toLowerCase().includes("comm") || String(w).toLowerCase().includes("empathy"));
  if (hasCommWeak || recommendedCourses.length === 0) {
    if (hasCommWeak) {
      skillGaps.push("Client interaction style gaps");
    }
    recommendedCourses.push("Customer Communication");
    recommendedSkills.push("Active Engagement");
  }

  if (recommendedCourses.length < 2) {
    if (level < 5) {
      recommendedCourses.push("AI Assisted Operations");
      recommendedSkills.push("AI Copilot Utilization");
    } else {
      recommendedCourses.push("Leadership Skills");
      recommendedSkills.push("Operational Mentoring");
    }
  }

  const milestones = [
    {
      week: 1,
      goals: [
        `Begin the recommended path: ${recommendedCourses[0]}`,
        "Review daily distribution queue prioritization rules"
      ],
      status: "in-progress"
    },
    {
      week: 2,
      goals: [
        `Complete all learning modules under path: ${recommendedCourses[0]}`,
        "Attempt and pass the module quiz checkpoint with a score of at least 80%"
      ],
      status: "upcoming"
    },
    {
      week: 3,
      goals: [
        recommendedCourses[1] ? `Start the secondary path: ${recommendedCourses[1]}` : "Improve daily record resolution speed to under 12 hours",
        "Maintain active consecutive completions streak to unlock XP modifiers"
      ],
      status: "upcoming"
    },
    {
      week: 4,
      goals: [
        "Pass all final module quizzes to unlock a verified license certification",
        "Align current stats with next tier checklist requirements"
      ],
      status: "upcoming"
    }
  ];

  return {
    currentLevel: careerLevel,
    targetLevel,
    recommendedSkills,
    recommendedCourses,
    estimatedCompletionWeeks: 4,
    milestones,
    strengths,
    skillGaps,
    careerSuggestions: [
      `Complete required learning courses to align with target tier criteria`,
      `Focus on maintaining SLA compliance and clearing critical priority backlogs`
    ]
  };
};

/**
 * Generates or refreshes a personalized career development plan for the agent.
 * @param {String} agentId - User ID of the agent
 * @param {Boolean} force - Force regeneration even if an active plan exists
 * @param {Object} [io] - Express Socket.IO instance
 * @returns {Promise<Object>} The generated DevelopmentPlan document
 */
const generateDevelopmentPlan = async (agentId, force = false, io = null) => {
  try {
    // 1. Return active plan if exists and not forced
    if (!force) {
      const activePlan = await DevelopmentPlan.findOne({ agentId, status: 'active' });
      if (activePlan) return activePlan;
    }

    // 2. Fetch context variables
    const [prod, sla, ranking, coaching, certs, user, careerStats] = await Promise.all([
      calculateProductivityScore(agentId),
      calculateSLAMetrics(agentId),
      calculateAgentRanking(agentId),
      AgentCoachingSnapshot.findOne({ agentId }).sort({ generatedAt: -1 }),
      Certification.find({ agentId }),
      User.findById(agentId),
      calculateAgentCareerStats(agentId)
    ]);

    if (!user) throw new Error('Agent user not found');

    const productivityScore = prod.score || 0;
    const slaCompliance = sla.slaCompliance || 0;
    const completedPathsCount = certs.length;
    const careerLevel = careerStats.careerLevel || "Associate Agent";

    const contextPayload = {
      agentName: user.name,
      metrics: {
        productivityScore,
        slaCompliance,
        rank: ranking,
        level: user.level || 1,
        completedPathsCount
      },
      careerStats,
      coachingWeaknesses: coaching?.weaknesses || [],
      coachingStrengths: coaching?.strengths || []
    };

    let planData;
    let source = 'ai';

    try {
      const userPrompt = `Agent Context details: ${JSON.stringify(contextPayload)}`;
      const aiResponse = await callGroq(SYSTEM_PROMPT, userPrompt);
      
      if (aiResponse && aiResponse.currentLevel && aiResponse.targetLevel && Array.isArray(aiResponse.milestones)) {
        planData = aiResponse;
      } else {
        throw new Error('Malformed AI planner payload');
      }
    } catch (err) {
      console.warn(`[DevelopmentPlanner] AI plan generation failed, utilizing rules fallback: ${err.message}`);
      planData = getFallbackPlan(careerLevel, productivityScore, slaCompliance, ranking, user.level, coaching, completedPathsCount);
      source = 'fallback';
    }

    // 3. Mark old active plans as archived
    await DevelopmentPlan.updateMany({ agentId, status: 'active' }, { status: 'archived' });

    // 4. Save new development plan
    const newPlan = await DevelopmentPlan.create({
      agentId,
      currentLevel: planData.currentLevel,
      targetLevel: planData.targetLevel,
      recommendedSkills: planData.recommendedSkills,
      recommendedCourses: planData.recommendedCourses,
      estimatedCompletionWeeks: planData.estimatedCompletionWeeks || 4,
      milestones: planData.milestones,
      strengths: planData.strengths,
      skillGaps: planData.skillGaps,
      careerSuggestions: planData.careerSuggestions,
      status: 'active'
    });

    // 5. Log activity
    await logActivity({
      actionType: 'DEVELOPMENT_PLAN_GENERATED',
      entityType: 'User',
      entityId: agentId,
      userId: agentId,
      metadata: { planId: newPlan._id, source }
    }, io);

    return newPlan;
  } catch (error) {
    console.error('⚠️ Error in generateDevelopmentPlan:', error.message);
    throw error;
  }
};

module.exports = {
  generateDevelopmentPlan
};
