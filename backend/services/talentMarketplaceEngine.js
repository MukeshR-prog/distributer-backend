const mongoose = require('mongoose');
const Opportunity = require('../models/Opportunity');
const OpportunityApplication = require('../models/OpportunityApplication');
const User = require('../models/User');
const Achievement = require('../models/Achievement');
const AgentAchievement = require('../models/AgentAchievement');
const ChannelMessage = require('../models/ChannelMessage');
const TaskDiscussion = require('../models/TaskDiscussion');
const Certification = require('../models/Certification');
const CareerProgressionSnapshot = require('../models/CareerProgressionSnapshot');
const { calculatePromotionReadiness } = require('./careerProgressionEngine');
const { calculateAgentCareerStats } = require('./careerGrowthEngine');
const { calculateProductivityScore } = require('./agentPerformanceEngine');

/**
 * Maps completed paths and courses to skills.
 */
const getAgentSkills = async (agentId) => {
  try {
    const certs = await Certification.find({ agentId }).populate('pathId').populate('courseId');
    const skillsSet = new Set();

    skillsSet.add('Basic Operations');
    skillsSet.add('Task Resolution');

    certs.forEach(c => {
      // Unpack skills from course-level certifications
      if (c.courseId && Array.isArray(c.courseId.skills)) {
        c.courseId.skills.forEach(s => skillsSet.add(s));
      }

      const pathName = c.pathId?.name || c.title || '';
      const nameLower = pathName.toLowerCase();
      
      if (nameLower.includes('comm') || nameLower.includes('customer')) {
        skillsSet.add('Customer Communication');
        skillsSet.add('Active Engagement');
        skillsSet.add('Client Interaction');
      }
      if (nameLower.includes('task') || nameLower.includes('operations')) {
        skillsSet.add('Task Management');
        skillsSet.add('Queue Prioritization');
        skillsSet.add('Workload Planning');
      }
      if (nameLower.includes('sla') || nameLower.includes('excellence')) {
        skillsSet.add('SLA Excellence');
        skillsSet.add('SLA Rescue Procedures');
        skillsSet.add('SLA Breach Prevention');
      }
      if (nameLower.includes('leadership') || nameLower.includes('skills')) {
        skillsSet.add('Leadership Skills');
        skillsSet.add('Operational Coaching');
        skillsSet.add('Operational Mentoring');
        skillsSet.add('Escalation Coordination');
      }
      if (nameLower.includes('prod') || nameLower.includes('optimization')) {
        skillsSet.add('Productivity Optimization');
        skillsSet.add('Streak Habit Building');
        skillsSet.add('Time Management');
      }
      if (nameLower.includes('ai') || nameLower.includes('assisted')) {
        skillsSet.add('AI Assisted Operations');
        skillsSet.add('AI Operations');
        skillsSet.add('AI Copilot Utilization');
        skillsSet.add('AI Operations Champion');
      }
    });

    return Array.from(skillsSet);
  } catch (error) {
    console.error('Error fetching agent skills:', error.message);
    return ['Basic Operations'];
  }
};

/**
 * Calculates a match percentage for an opportunity (0-100).
 */
const calculateMatchScore = async (agentId, opportunity) => {
  try {
    let readinessScore = 0;
    const snapshot = await CareerProgressionSnapshot.findOne({ agentId }).sort({ generatedAt: -1 });
    if (snapshot) {
      readinessScore = snapshot.readinessScore;
    } else {
      const readinessResult = await calculatePromotionReadiness(agentId);
      readinessScore = readinessResult.readinessScore;
    }

    const careerStats = await calculateAgentCareerStats(agentId);
    const learningCompletion = careerStats.skillScore || 0;

    const totalAchievementsCount = await Achievement.countDocuments();
    const unlockedAchievementsCount = await AgentAchievement.countDocuments({ agentId, isUnlocked: true });
    const achievements = totalAchievementsCount > 0 ? Math.round((unlockedAchievementsCount / totalAchievementsCount) * 100) : 100;

    const prodResult = await calculateProductivityScore(agentId);
    const productivity = prodResult.score || 0;

    const [messageCount, discussionCount, replyCount] = await Promise.all([
      ChannelMessage.countDocuments({ sender: agentId }),
      TaskDiscussion.countDocuments({ sender: agentId }),
      TaskDiscussion.countDocuments({ 'replies.sender': agentId })
    ]);
    const totalCollabActions = messageCount + discussionCount + replyCount;
    const collaboration = Math.min(Math.round((totalCollabActions / 20) * 100), 100);

    // Consolidated Base Match (Formula: 30% Readiness, 20% Learning, 15% Achievements, 20% Productivity, 15% Collab)
    const baseMatchScore = Math.round(
      (readinessScore * 0.30) +
      (learningCompletion * 0.20) +
      (achievements * 0.15) +
      (productivity * 0.20) +
      (collaboration * 0.15)
    );

    // Skill Match
    const agentSkills = await getAgentSkills(agentId);
    const requiredSkills = opportunity.requiredSkills || [];
    
    let skillMatchScore = 100;
    if (requiredSkills.length > 0) {
      const matchingCount = requiredSkills.filter(skill => agentSkills.includes(skill)).length;
      skillMatchScore = Math.round((matchingCount / requiredSkills.length) * 100);
    }

    // Certification Match Boost
    let certificationBoost = 0;
    const opportunityCategory = opportunity.category; // Enum e.g. MENTORSHIP, LEADERSHIP, PROJECT
    const populatedCerts = await Certification.find({ userId: agentId }).populate('courseId');

    const hasLeadershipCert = populatedCerts.some(c => c.courseId?.category === 'Leadership' || c.courseId?.category === 'Management');
    const hasOperationsCert = populatedCerts.some(c => c.courseId?.category === 'Operations');
    const hasCommunicationCert = populatedCerts.some(c => c.courseId?.category === 'Communication');
    const hasAnalyticsCert = populatedCerts.some(c => c.courseId?.category === 'Analytics' || c.courseId?.category === 'Technical');

    if (opportunityCategory === 'LEADERSHIP' && hasLeadershipCert) {
      certificationBoost += 15;
    } else if (opportunityCategory === 'MENTORSHIP' && (hasLeadershipCert || hasCommunicationCert)) {
      certificationBoost += 15;
    } else if (opportunityCategory === 'SPECIAL_ASSIGNMENT' && (hasOperationsCert || hasAnalyticsCert)) {
      certificationBoost += 15;
    } else if (opportunityCategory === 'PROJECT' && hasAnalyticsCert) {
      certificationBoost += 15;
    }

    // Final consolidated matchmaking rating (70% Base Metrics, 30% Skill coverage) + Certification Boost
    const finalScore = Math.min(Math.round((baseMatchScore * 0.7) + (skillMatchScore * 0.3)) + certificationBoost, 100);
    return {
      matchScore: finalScore,
      readinessScore,
      agentSkills
    };
  } catch (error) {
    console.error('Error calculating match score:', error.message);
    return { matchScore: 50, readinessScore: 50, agentSkills: [] };
  }
};

/**
 * Seeding default opportunities if empty
 */
const seedDefaultOpportunities = async () => {
  try {
    const count = await Opportunity.countDocuments();
    if (count > 0) return;

    console.log('🌱 Seeding default opportunities in Talent Marketplace...');

    let admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      admin = await User.findOne({});
    }

    const createdBy = admin ? admin._id : new mongoose.Types.ObjectId();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days expiry

    const defaults = [
      {
        title: 'Team Lead Development Program',
        description: 'Accelerated track for top-performing agents to transition into operational management, focusing on escalation coordination and lead coaching skills.',
        category: 'LEADERSHIP',
        requiredSkills: ['Leadership Skills', 'Operational Coaching', 'Escalation Coordination'],
        minimumReadinessScore: 80,
        rewardPoints: 1000,
        createdBy,
        expiresAt
      },
      {
        title: 'Advanced Productivity Challenge',
        description: 'Elite task-resolution queue assignment requiring high daily streaks, quick record turnover, and time management optimizations.',
        category: 'SPECIAL_ASSIGNMENT',
        requiredSkills: ['Productivity Optimization', 'Streak Habit Building', 'Time Management'],
        minimumReadinessScore: 70,
        rewardPoints: 500,
        createdBy,
        expiresAt
      },
      {
        title: 'SLA Excellence Program',
        description: 'Strategic assignment focusing on resolving critical bottlenecks, breach rescue workflows, and high-importance dispatch queues.',
        category: 'SPECIAL_ASSIGNMENT',
        requiredSkills: ['SLA Excellence', 'SLA Rescue Procedures', 'SLA Breach Prevention'],
        minimumReadinessScore: 75,
        rewardPoints: 600,
        createdBy,
        expiresAt
      },
      {
        title: 'AI Operations Champion',
        description: 'Research assignment to build prompt libraries, test copilot automation templates, and streamline distribution tasks using LLM toolsets.',
        category: 'PROJECT',
        requiredSkills: ['AI Assisted Operations', 'AI Operations', 'AI Operations Champion'],
        minimumReadinessScore: 65,
        rewardPoints: 400,
        createdBy,
        expiresAt
      },
      {
        title: 'Operations Mentorship Circle',
        description: 'Opportunity to host operational coaching sessions, review audit checklists for junior agents, and support active onboarding channels.',
        category: 'MENTORSHIP',
        requiredSkills: ['Leadership Skills', 'Active Engagement', 'Client Interaction'],
        minimumReadinessScore: 80,
        rewardPoints: 800,
        createdBy,
        expiresAt
      }
    ];

    await Opportunity.create(defaults);
    console.log('✅ Successfully seeded default opportunities.');
  } catch (error) {
    console.error('⚠️ Error seeding default opportunities:', error.message);
  }
};

/**
 * Generates ranked opportunity recommendations for an agent
 */
const generateRecommendations = async (agentId) => {
  try {
    const activeOpportunities = await Opportunity.find({
      status: 'active',
      expiresAt: { $gte: new Date() }
    });

    const recommendations = [];

    for (const opp of activeOpportunities) {
      const { matchScore, readinessScore, agentSkills } = await calculateMatchScore(agentId, opp);
      
      const missingRequirements = [];
      if (readinessScore < opp.minimumReadinessScore) {
        missingRequirements.push(`Promotion readiness score too low (${readinessScore} < ${opp.minimumReadinessScore})`);
      }
      
      opp.requiredSkills.forEach(skill => {
        if (!agentSkills.includes(skill)) {
          missingRequirements.push(`Missing skill: ${skill}`);
        }
      });

      recommendations.push({
        opportunity: opp,
        matchPercentage: matchScore,
        missingRequirements
      });
    }

    // Sort by match percentage descending
    recommendations.sort((a, b) => b.matchPercentage - a.matchPercentage);
    return recommendations;
  } catch (error) {
    console.error('Error in generateRecommendations:', error.message);
    throw error;
  }
};

module.exports = {
  seedDefaultOpportunities,
  calculateMatchScore,
  generateRecommendations
};
