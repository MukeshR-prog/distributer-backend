const SuccessionCandidate = require('../models/SuccessionCandidate');
const User = require('../models/User');
const Achievement = require('../models/Achievement');
const AgentAchievement = require('../models/AgentAchievement');
const ChannelMessage = require('../models/ChannelMessage');
const TaskDiscussion = require('../models/TaskDiscussion');
const Certification = require('../models/Certification');
const CoachingAction = require('../models/CoachingAction');
const AgentCoachingSnapshot = require('../models/AgentCoachingSnapshot');
const CareerProgressionSnapshot = require('../models/CareerProgressionSnapshot');
const { callGroq } = require('./groqService');
const { logActivity } = require('../utils/activityLogger');
const { calculateProductivityScore } = require('./agentPerformanceEngine');
const { calculatePromotionReadiness } = require('./careerProgressionEngine');
const { calculateAgentCareerStats } = require('./careerGrowthEngine');

const SYSTEM_PROMPT = `You are an organizational development expert and executive talent coach for a distribution operations center.
Based on the agent's performance, coaching compliance, learning progression, collaboration metrics, leadership score, readiness score, succession tier, and target role, recommend a strategic succession profile.
Your response MUST be a single, valid JSON object matching the JSON schema below:
{
  "strengths": ["string"],
  "developmentAreas": ["string"],
  "recommendationReason": "string",
  "estimatedReadinessDate": "string (YYYY-MM-DD)",
  "developmentRecommendations": {
    "leadershipTraining": "string",
    "communicationTraining": "string",
    "projectOwnershipGoals": "string",
    "mentorshipGoals": "string"
  }
}
Ensure the output is pure JSON. Do not include any markdown, explanation wrappers, or extra text.`;

/**
 * Rules-based fallback for generating candidate strategic leadership descriptions.
 */
const getFallbackSuccessionData = (name, targetRole, leadershipScore, readinessScore, successionTier, productivity, collaboration, learningProgress, influenceScore, isInfluencerRecommended) => {
  const strengths = [];
  if (productivity >= 80) strengths.push("Strong task execution speed and productivity consistency");
  if (collaboration >= 75) strengths.push("Proactive communication and cross-functional team participation");
  if (learningProgress >= 60) strengths.push("Committed to ongoing certification and skills development");
  if (strengths.length === 0) strengths.push("Reliable operational performance and attention to detail");

  const developmentAreas = [];
  if (productivity < 80) developmentAreas.push("Enhance operational queue capacity and daily volume throughput");
  if (collaboration < 70) developmentAreas.push("Increase engagement in task discussions and channel coordination");
  if (learningProgress < 60) developmentAreas.push("Prioritize completing core learning path courses");
  if (developmentAreas.length === 0) developmentAreas.push("Develop formal peer mentoring and escalation management skills");

  let recommendationReason = "";
  if (isInfluencerRecommended) {
    recommendationReason = `${name} is highly recommended as a Future Team Lead Candidate due to exceptional network influence (${influenceScore}/100) and collaboration presence.`;
  } else if (successionTier === 'Strategic Successor') {
    recommendationReason = `${name} exhibits exceptional readiness and leadership qualities, making them an immediate successor for a ${targetRole} position.`;
  } else if (successionTier === 'High Potential') {
    recommendationReason = `${name} shows high potential with strong performance metrics and active engagement, well-suited for a ${targetRole} path.`;
  } else if (successionTier === 'Leadership Ready') {
    recommendationReason = `${name} has achieved solid baseline skills and is ready to start preparation for a ${targetRole} transition.`;
  } else {
    recommendationReason = `${name} is an emerging leader who can develop toward a ${targetRole} role with targeted coaching.`;
  }

  // Recommended Team Lead candidate check
  if (!isInfluencerRecommended && readinessScore > 80 && productivity > 85 && collaboration > 75) {
    recommendationReason = `${name} is highly recommended as a Future Team Lead Candidate due to exceptional readiness, productivity, and collaboration activity.`;
  }

  let months = 12;
  if (successionTier === 'Strategic Successor') months = 3;
  else if (successionTier === 'High Potential') months = 6;
  else if (successionTier === 'Leadership Ready') months = 9;
  const estimatedReadinessDate = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000);

  const developmentRecommendations = {
    leadershipTraining: isInfluencerRecommended 
      ? "Complete advanced 'Network Leadership and Departmental Coordination' masterclass."
      : "Participate in conflict resolution, task prioritization, and queue oversight training.",
    communicationTraining: isInfluencerRecommended
      ? "Lead weekly operations updates and alignment syncs across departments."
      : "Lead status updates in team channels and active operations discussions.",
    projectOwnershipGoals: "Take ownership of complex task distribution sets and SLA breach prevention.",
    mentorshipGoals: isInfluencerRecommended
      ? "Take on formal peer mentoring role for 2+ junior agents."
      : "Mentor newer agents and guide them through operational queue issues."
  };

  return {
    strengths,
    developmentAreas,
    recommendationReason,
    estimatedReadinessDate,
    developmentRecommendations
  };
};

/**
 * Calculates leadership score (0-100) for an agent
 */
const calculateLeadershipScore = async (agentId, graphData = null) => {
  try {
    const [prodResult, readinessResult, careerStats, user] = await Promise.all([
      calculateProductivityScore(agentId),
      calculatePromotionReadiness(agentId),
      calculateAgentCareerStats(agentId),
      User.findById(agentId)
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const productivity = prodResult.score || 0;
    const readinessScore = readinessResult.readinessScore || 0;
    const learningProgress = careerStats.skillScore || 0;

    // Achievements calculation
    const totalAchievementsCount = await Achievement.countDocuments();
    const unlockedAchievementsCount = await AgentAchievement.countDocuments({ agentId, isUnlocked: true });
    const achievements = totalAchievementsCount > 0 ? Math.round((unlockedAchievementsCount / totalAchievementsCount) * 100) : 100;

    // Collaboration & Network Influence calculation
    let collaboration = 0;
    let influenceScore = 15; // default minimum

    if (graphData && graphData.agents) {
      const graphAgent = graphData.agents.find(a => a.id === agentId.toString());
      if (graphAgent) {
        influenceScore = graphAgent.influenceScore || 15;
        collaboration = Math.min(Math.round((graphAgent.interactions / 20) * 100), 100);
      }
    } else {
      const [messageCount, discussionCount, replyCount] = await Promise.all([
        ChannelMessage.countDocuments({ sender: agentId }),
        TaskDiscussion.countDocuments({ sender: agentId }),
        TaskDiscussion.countDocuments({ 'replies.sender': agentId })
      ]);
      const totalCollabActions = messageCount + discussionCount + replyCount;
      collaboration = Math.min(Math.round((totalCollabActions / 20) * 100), 100);
    }

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

    // Level score (gamification level)
    const gamificationLevel = Math.min((user.level || 1) * 10, 100);

    const leadershipScore = Math.round(
      (productivity * 0.20) +
      (readinessScore * 0.20) +
      (learningProgress * 0.15) +
      (collaboration * 0.10) +
      (influenceScore * 0.10) +
      (coachingProgress * 0.10) +
      (achievements * 0.07) +
      (gamificationLevel * 0.08)
    );

    return {
      leadershipScore,
      readinessScore,
      productivity,
      collaboration,
      learningProgress,
      coachingProgress,
      achievements,
      gamificationLevel,
      user,
      influenceScore
    };
  } catch (err) {
    console.error(`Error in calculateLeadershipScore for agent ${agentId}:`, err.message);
    throw err;
  }
};

/**
 * Returns latest succession candidate documents for all active agents.
 */
const getLatestCandidates = async () => {
  const latestCandidates = await SuccessionCandidate.aggregate([
    { $sort: { generatedAt: -1 } },
    {
      $group: {
        _id: '$agentId',
        doc: { $first: '$$ROOT' }
      }
    },
    { $replaceRoot: { newRoot: '$doc' } }
  ]);

  const populated = await SuccessionCandidate.populate(latestCandidates, { path: 'agentId' });
  return populated.filter(c => c.agentId != null);
};

/**
 * Scans active agents and saves their succession metrics.
 */
const identifyHighPotentialEmployees = async (force = false, io = null) => {
  try {
    const agents = await User.find({ role: 'agent', isActive: true });
    
    // Fetch communication graph once for all agents
    const { analyzeCommunicationGraph } = require('./networkIntelligenceEngine');
    const graphData = await analyzeCommunicationGraph().catch(err => {
      console.error('Error analyzing communication graph in successionEngine:', err.message);
      return null;
    });

    const candidates = [];
    const generationBatchTime = new Date();

    for (const agent of agents) {
      if (!force) {
        const existing = await SuccessionCandidate.findOne({ agentId: agent._id }).sort({ generatedAt: -1 });
        if (existing && (Date.now() - new Date(existing.generatedAt).getTime()) < 24 * 60 * 60 * 1000) {
          candidates.push(existing);
          continue;
        }
      }

      const scoreDetails = await calculateLeadershipScore(agent._id, graphData);
      let {
        leadershipScore,
        readinessScore,
        productivity,
        collaboration,
        learningProgress,
        coachingProgress,
        achievements,
        user,
        influenceScore
      } = scoreDetails;

      // Check if they have completed a leadership track course certification
      const LearningCourse = require('../models/LearningCourse');
      const leadershipCourses = await LearningCourse.find({ category: 'Leadership' }).distinct('_id');
      const completedLeadershipCerts = await Certification.countDocuments({
        userId: agent._id,
        courseId: { $in: leadershipCourses }
      });

      if (completedLeadershipCerts > 0) {
        // Boost leadershipScore by 10 points
        leadershipScore = Math.min(100, leadershipScore + 10);
      }

      // Determine Succession Tier
      let successionTier = 'Emerging Leader';
      if (leadershipScore >= 85 && readinessScore >= 80) successionTier = 'Strategic Successor';
      else if (leadershipScore >= 75 || readinessScore >= 75) successionTier = 'High Potential';
      else if (leadershipScore >= 60) successionTier = 'Leadership Ready';

      // Automatically upgrade succession eligibility tier if leadership course completed
      if (completedLeadershipCerts > 0) {
        if (successionTier === 'Emerging Leader') successionTier = 'Leadership Ready';
        else if (successionTier === 'Leadership Ready') successionTier = 'High Potential';
        else if (successionTier === 'High Potential') successionTier = 'Strategic Successor';
      }

      const isInfluencerRecommended = influenceScore >= 70 && readinessScore >= 75;

      // Map progression snapshots to pipeline target roles
      const activeSnapshot = await CareerProgressionSnapshot.findOne({ agentId: agent._id }).sort({ generatedAt: -1 });
      const nextRole = activeSnapshot?.nextRole || 'Professional Agent';

      let targetRole = 'Mentor';
      if (nextRole === 'Lead Agent') {
        targetRole = 'Team Lead';
      } else if (nextRole === 'Operations Specialist') {
        targetRole = 'Department Coordinator';
      } else if (nextRole === 'Operations Expert' || nextRole === 'Senior Agent') {
        targetRole = 'Operations Specialist';
      } else {
        // Fallback target role mapping based on leadership potential score
        if (leadershipScore >= 80) targetRole = 'Operations Specialist';
        else if (leadershipScore >= 65) targetRole = 'Team Lead';
        else if (leadershipScore >= 50) targetRole = 'Department Coordinator';
      }

      // Generate strategic evaluations via Groq AI or Fallback
      let aiData;
      let source = 'ai';

      try {
        const contextPayload = {
          agentName: user.name,
          targetRole,
          readinessScore,
          leadershipScore,
          successionTier,
          productivity,
          collaboration,
          learningProgress,
          coachingProgress,
          achievements,
          influenceScore,
          isInfluencerRecommended
        };

        const userPrompt = `Succession Planning Context: ${JSON.stringify(contextPayload)}`;
        const response = await callGroq(SYSTEM_PROMPT, userPrompt);

        if (response && Array.isArray(response.strengths) && response.recommendationReason) {
          aiData = {
            strengths: response.strengths,
            developmentAreas: response.developmentAreas || [],
            recommendationReason: response.recommendationReason,
            estimatedReadinessDate: response.estimatedReadinessDate ? new Date(response.estimatedReadinessDate) : null,
            developmentRecommendations: response.developmentRecommendations
          };
        } else {
          throw new Error('Malformed AI succession schema output');
        }
      } catch (err) {
        console.warn(`[SuccessionEngine] AI candidate review failed, falling back to rule base: ${err.message}`);
        const fallback = getFallbackSuccessionData(user.name, targetRole, leadershipScore, readinessScore, successionTier, productivity, collaboration, learningProgress, influenceScore, isInfluencerRecommended);
        aiData = {
          strengths: fallback.strengths,
          developmentAreas: fallback.developmentAreas,
          recommendationReason: fallback.recommendationReason,
          estimatedReadinessDate: fallback.estimatedReadinessDate,
          developmentRecommendations: fallback.developmentRecommendations
        };
        source = 'fallback';
      }

      // Create new succession candidate entry
      const candidate = await SuccessionCandidate.create({
        agentId: agent._id,
        targetRole,
        readinessScore,
        leadershipScore,
        successionTier,
        strengths: aiData.strengths,
        developmentAreas: aiData.developmentAreas,
        recommendationReason: aiData.recommendationReason,
        influenceScore,
        isInfluencerRecommended,
        estimatedReadinessDate: aiData.estimatedReadinessDate || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        generatedAt: generationBatchTime,
      });

      // Save custom fields in metadata/snapshot structure if needed, or compute recommendations dynamically
      candidates.push(candidate);
    }

    await logActivity({
      actionType: 'SUCCESSION_PIPELINE_REGENERATED',
      entityType: 'User',
      entityId: agents[0]?._id, // Logger defaults
      userId: agents[0]?._id,
      metadata: { candidatesCount: candidates.length, force }
    }, io);

    return getLatestCandidates();
  } catch (err) {
    console.error('Error identifying high-potential succession candidates:', err.message);
    throw err;
  }
};

/**
 * Returns pipeline structures ranked by scores
 */
const generateSuccessionPipeline = async () => {
  try {
    const candidates = await getLatestCandidates();

    // Map targets to ranked lists
    const teamLeadPipeline = candidates.filter(c => c.targetRole === 'Team Lead').sort((a, b) => b.leadershipScore - a.leadershipScore);
    const mentorPipeline = candidates.filter(c => c.targetRole === 'Mentor').sort((a, b) => b.leadershipScore - a.leadershipScore);
    const departmentLeadPipeline = candidates.filter(c => c.targetRole === 'Department Coordinator').sort((a, b) => b.leadershipScore - a.leadershipScore);
    const executivePipeline = candidates.filter(c => c.targetRole === 'Operations Specialist').sort((a, b) => b.leadershipScore - a.leadershipScore);

    return {
      teamLeadPipeline,
      mentorPipeline,
      departmentLeadPipeline,
      executivePipeline
    };
  } catch (err) {
    console.error('Error generating succession pipeline lists:', err.message);
    throw err;
  }
};

/**
 * Creates development plans/recommendations for a candidate
 */
const generateDevelopmentRecommendations = (candidate) => {
  const leadershipScore = candidate.leadershipScore || 50;
  const readinessScore = candidate.readinessScore || 50;
  const tier = candidate.successionTier || 'Emerging Leader';
  const role = candidate.targetRole || 'Mentor';
  const isInfluencerRecommended = candidate.isInfluencerRecommended || false;
  const influenceScore = candidate.influenceScore || 15;

  // Rule-based recommendations based on leadership metric parameters
  let leadershipTraining = "Participate in conflict resolution, task prioritization, and queue oversight training.";
  let communicationTraining = "Lead status updates in team channels and active operations discussions.";
  let projectOwnershipGoals = "Take ownership of complex task distribution sets and SLA breach prevention.";
  let mentorshipGoals = "Mentor newer agents and guide them through operational queue issues.";

  if (isInfluencerRecommended) {
    leadershipTraining = "Complete advanced 'Network Leadership and Departmental Coordination' masterclass.";
    communicationTraining = "Lead weekly operations updates and alignment syncs across departments.";
    mentorshipGoals = "Take on formal peer mentoring role for 2+ junior agents.";
  } else if (tier === 'Strategic Successor') {
    leadershipTraining = `Complete advanced "${role} Executive Masterclass" training and shadow current leaders.`;
    projectOwnershipGoals = "Lead cross-functional workspace optimization projects and SLA audits.";
  } else if (tier === 'Emerging Leader') {
    leadershipTraining = "Enroll in basic 'Leadership Skills' courses in the Learning Center.";
    communicationTraining = "Contribute actively in task discussions and channel replies.";
  }

  return {
    leadershipTraining,
    communicationTraining,
    projectOwnershipGoals,
    mentorshipGoals
  };
};

module.exports = {
  calculateLeadershipScore,
  identifyHighPotentialEmployees,
  generateSuccessionPipeline,
  generateDevelopmentRecommendations,
  getLatestCandidates
};
