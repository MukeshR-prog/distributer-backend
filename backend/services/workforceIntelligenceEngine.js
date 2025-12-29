const User = require('../models/User');
const WorkforceRecommendation = require('../models/WorkforceRecommendation');
const SuccessionCandidate = require('../models/SuccessionCandidate');
const Opportunity = require('../models/Opportunity');
const OpportunityApplication = require('../models/OpportunityApplication');
const { calculateLeadershipScore, getLatestCandidates } = require('./successionEngine');
const { calculateCurrentWorkforceMetrics } = require('./workforceOptimizer');
const { identifyOrganizationalRisks, analyzeCommunicationGraph } = require('./networkIntelligenceEngine');
const { logActivity } = require('../utils/activityLogger');

/**
 * Calculates a confidence score (0-100) based on weighted factors:
 * Readiness (25%), Influence (20%), Productivity (25%), Learning (15%), Collaboration (15%)
 */
const calculateConfidenceScore = async (agentId, scoreDetails = null) => {
  try {
    const details = scoreDetails || await calculateLeadershipScore(agentId);
    const readiness = details.readinessScore || 0;
    const influence = details.influenceScore || 15;
    const productivity = details.productivity || 0;
    const learning = details.learningProgress || 0;
    const collaboration = details.collaboration || 0;

    const confidenceScore = Math.round(
      (readiness * 0.25) +
      (influence * 0.20) +
      (productivity * 0.25) +
      (learning * 0.15) +
      (collaboration * 0.15)
    );

    return Math.max(10, Math.min(100, confidenceScore));
  } catch (err) {
    console.error(`Error calculating confidence score for agent ${agentId}:`, err.message);
    return 50;
  }
};

/**
 * Generates unified workforce recommendations
 */
const generateRecommendations = async (force = false, io = null) => {
  try {
    const activeCount = await WorkforceRecommendation.countDocuments({ status: 'ACTIVE' });
    if (activeCount > 0 && !force) {
      // Recommendations already exist and we aren't forcing regeneration
      return await WorkforceRecommendation.find({ status: 'ACTIVE' }).populate('targetId');
    }

    // Clear active recommendations to replace them
    await WorkforceRecommendation.deleteMany({ status: 'ACTIVE' });

    const agents = await User.find({ role: 'agent', isActive: true });
    const graphData = await analyzeCommunicationGraph().catch(() => null);

    const generated = [];

    // 1. Agent-level recommendations
    for (const agent of agents) {
      const details = await calculateLeadershipScore(agent._id, graphData).catch(() => null);
      if (!details) continue;

      const confidence = await calculateConfidenceScore(agent._id, details);

      const readiness = details.readinessScore || 0;
      const influence = details.influenceScore || 15;
      const productivity = details.productivity || 0;
      const learning = details.learningProgress || 0;
      const collaboration = details.collaboration || 0;

      // PROMOTION / LEADERSHIP recommendation rules
      if (readiness >= 80 && influence >= 75 && productivity >= 80) {
        generated.push({
          recommendationType: 'PROMOTION',
          targetType: 'User',
          targetId: agent._id,
          title: `Promote ${agent.name} to Team Lead`,
          description: `${agent.name} has demonstrated outstanding promotion readiness (${readiness}%), excellent network presence (${influence}/100), and top-tier productivity (${productivity}%). We recommend moving them to a Team Lead role.`,
          priority: readiness >= 90 ? 'CRITICAL' : 'HIGH',
          confidenceScore: confidence,
          sourceSystems: ['CareerProgression', 'SuccessionPlanning', 'NetworkIntelligence'],
          status: 'ACTIVE'
        });
      }

      // MENTORSHIP recommendation rules
      if (learning >= 75 && collaboration >= 70 && influence >= 70) {
        generated.push({
          recommendationType: 'MENTORSHIP',
          targetType: 'User',
          targetId: agent._id,
          title: `Assign ${agent.name} as Operations Mentor`,
          description: `${agent.name} has completed significant training modules (${learning}%) and maintains a high cross-department collaboration rating. They are highly suited to act as a mentor for newer agents.`,
          priority: 'MEDIUM',
          confidenceScore: confidence,
          sourceSystems: ['LearningCenter', 'NetworkIntelligence'],
          status: 'ACTIVE'
        });
      }

      // RETENTION_RISK recommendation rules
      if (productivity >= 85 && readiness >= 75 && collaboration < 30) {
        generated.push({
          recommendationType: 'RETENTION_RISK',
          targetType: 'User',
          targetId: agent._id,
          title: `Retention Alert: ${agent.name}`,
          description: `${agent.name} is a high-performing agent (Productivity: ${productivity}%) with high promotion readiness, but they are relatively isolated in the communication network (Collaboration Score: ${collaboration}%). Recommended to engage in a formal feedback check-in.`,
          priority: 'CRITICAL',
          confidenceScore: Math.round(confidence * 0.9), // adjust risk confidence
          sourceSystems: ['PerformanceAnalytics', 'NetworkIntelligence', 'CareerProgression'],
          status: 'ACTIVE'
        });
      }

      // TRAINING recommendation rules
      if (productivity < 70 || learning < 50) {
        generated.push({
          recommendationType: 'TRAINING',
          targetType: 'User',
          targetId: agent._id,
          title: `Upskill Syllabus Enrollment for ${agent.name}`,
          description: `${agent.name}'s training progress is currently low (${learning}%) or productivity needs improvement. Enrolling them in the core 'Productivity Optimization' and 'Task Management' paths is recommended.`,
          priority: 'MEDIUM',
          confidenceScore: Math.min(95, Math.round(100 - productivity)),
          sourceSystems: ['LearningCenter', 'PerformanceAnalytics'],
          status: 'ACTIVE'
        });
      }

      // Check for missing skills/certifications from CareerProgressionSnapshot
      const CareerProgressionSnapshot = require('../models/CareerProgressionSnapshot');
      const careerSnapshot = await CareerProgressionSnapshot.findOne({ agentId: agent._id }).sort({ generatedAt: -1 });
      if (careerSnapshot) {
        if (careerSnapshot.missingSkills && careerSnapshot.missingSkills.length > 0) {
          generated.push({
            recommendationType: 'TRAINING',
            targetType: 'User',
            targetId: agent._id,
            title: `Resolve Missing Skills: ${agent.name}`,
            description: `${agent.name} is missing key growth skills: ${careerSnapshot.missingSkills.join(', ')}. We recommend enrolling them in relevant certification courses matching these skills.`,
            priority: 'HIGH',
            confidenceScore: Math.round(confidence * 0.95),
            sourceSystems: ['CareerProgression', 'LearningCenter'],
            status: 'ACTIVE'
          });
        }
        
        if (careerSnapshot.recommendedCertifications && careerSnapshot.recommendedCertifications.length > 0) {
          generated.push({
            recommendationType: 'TRAINING',
            targetType: 'User',
            targetId: agent._id,
            title: `Required Certification: ${agent.name}`,
            description: `To progress further, ${agent.name} requires recommended certifications: ${careerSnapshot.recommendedCertifications.join(', ')}. Complete these in the Learning Center.`,
            priority: 'HIGH',
            confidenceScore: Math.round(confidence * 0.95),
            sourceSystems: ['CareerProgression', 'LearningCenter'],
            status: 'ACTIVE'
          });
        }
      }

      // Check if they are a succession candidate and recommend leadership readiness courses
      const SuccessionCandidate = require('../models/SuccessionCandidate');
      const successionCandidate = await SuccessionCandidate.findOne({ agentId: agent._id }).sort({ generatedAt: -1 });
      if (successionCandidate) {
        const Certification = require('../models/Certification');
        const LearningCourse = require('../models/LearningCourse');
        const leadershipCourses = await LearningCourse.find({ category: 'Leadership' }).distinct('_id');
        const hasLeadershipCert = await Certification.exists({
          userId: agent._id,
          courseId: { $in: leadershipCourses }
        });

        if (!hasLeadershipCert) {
          generated.push({
            recommendationType: 'LEADERSHIP',
            targetType: 'User',
            targetId: agent._id,
            title: `Leadership Readiness Course for ${agent.name}`,
            description: `${agent.name} is identified as a succession candidate for ${successionCandidate.targetRole || 'Mentor'} but has not completed the leadership tracks. Enroll them in "Executive Leadership & Mentorship" to lock in eligibility.`,
            priority: 'HIGH',
            confidenceScore: Math.round(confidence * 0.9),
            sourceSystems: ['SuccessionPlanning', 'LearningCenter'],
            status: 'ACTIVE'
          });
        }
      }
    }

    // 2. Department-level workload shift rules
    const departments = await User.distinct('department', { role: 'agent', isActive: true });
    if (departments.length >= 2) {
      const deptMetrics = [];
      for (const dept of departments) {
        const deptAgents = await User.find({ department: dept, role: 'agent', isActive: true });
        if (deptAgents.length === 0) continue;
        
        let totalActiveTasks = 0;
        const capacityLimit = 15;
        const totalCapacity = deptAgents.length * capacityLimit;

        const { calculateAgentRiskAsOf } = require('../utils/riskCalculator');
        const Distribution = require('../models/Distribution');
        const distributions = await Distribution.find({});

        deptAgents.forEach(a => {
          const risk = calculateAgentRiskAsOf(a._id, distributions, new Date());
          totalActiveTasks += risk.activeTasks;
        });

        const utilization = Math.round((totalActiveTasks / totalCapacity) * 100);
        deptMetrics.push({ department: dept, utilization, agentsCount: deptAgents.length });
      }

      // Find overloaded and underloaded departments
      const overloaded = deptMetrics.find(d => d.utilization > 80);
      const underloaded = deptMetrics.find(d => d.utilization < 50);

      if (overloaded && underloaded) {
        // Create random active agent from overloaded to link target (Mongoose ref requires a valid model ObjectId or we link to an agent in overloaded dept)
        const sampleAgent = await User.findOne({ department: overloaded.department, role: 'agent', isActive: true });
        
        generated.push({
          recommendationType: 'WORKLOAD_SHIFT',
          targetType: 'Department',
          targetId: sampleAgent ? sampleAgent._id : agents[0]?._id, // fallback targetId
          title: `Balance Workload: ${overloaded.department} to ${underloaded.department}`,
          description: `The ${overloaded.department} department is operating at ${overloaded.utilization}% utilization, while ${underloaded.department} is underutilized at ${underloaded.utilization}%. We recommend shifting active queues/dispatch limits to balance system capacity.`,
          priority: 'HIGH',
          confidenceScore: Math.round(85 - (underloaded.utilization / 2)),
          sourceSystems: ['WorkforceOptimizer'],
          status: 'ACTIVE'
        });
      }
    }

    // Save all to database
    const savedRecommendations = [];
    for (const rec of generated) {
      const saved = await WorkforceRecommendation.create(rec);
      savedRecommendations.push(saved);
    }

    await logActivity({
      actionType: 'WORKFORCE_RECOMMENDATIONS_REGENERATED',
      entityType: 'User',
      entityId: agents[0]?._id,
      userId: agents[0]?._id,
      metadata: { count: savedRecommendations.length }
    }, io);

    if (io) {
      io.emit('workforceRecommendationsUpdated', { message: 'Recommendations recalculated successfully' });
    }

    return WorkforceRecommendation.find({ status: 'ACTIVE' }).populate('targetId');
  } catch (err) {
    console.error('Error generating workforce recommendations:', err.message);
    throw err;
  }
};

/**
 * Compiles strategic briefings and executive intelligence insights
 */
const generateExecutiveInsights = async () => {
  try {
    const metrics = await calculateCurrentWorkforceMetrics();
    const risks = await identifyOrganizationalRisks().catch(() => ({ isolatedEmployees: [], knowledgeSilos: [], bottlenecks: [] }));
    const successionCandidates = await getLatestCandidates();

    // 1. Leadership Pipeline Health
    const successorsCount = successionCandidates.filter(
      c => c.successionTier === 'Strategic Successor' || c.successionTier === 'High Potential'
    ).length;

    let totalReadiness = 0;
    successionCandidates.forEach(c => {
      totalReadiness += c.readinessScore || 0;
    });
    const avgPipelineReadiness = successionCandidates.length > 0 ? Math.round(totalReadiness / successionCandidates.length) : 0;

    // 2. Active Talent Opportunities Matchups
    const opportunities = await Opportunity.find({ status: 'active', expiresAt: { $gte: new Date() } }).limit(5);
    const topOpportunities = [];

    const agents = await User.find({ role: 'agent', isActive: true });
    const { calculateMatchScore } = require('./talentMarketplaceEngine');

    for (const opp of opportunities) {
      let bestAgent = null;
      let highestMatch = 0;

      for (const agent of agents) {
        const { matchScore } = await calculateMatchScore(agent._id, opp);
        if (matchScore > highestMatch && matchScore >= 75) {
          highestMatch = matchScore;
          bestAgent = agent;
        }
      }

      if (bestAgent) {
        topOpportunities.push({
          opportunityTitle: opp.title,
          category: opp.category,
          bestCandidateName: bestAgent.name,
          matchPercentage: highestMatch
        });
      }
    }

    // 3. Retention Risks Count
    const activeRetentionRisks = await WorkforceRecommendation.countDocuments({
      recommendationType: 'RETENTION_RISK',
      status: 'ACTIVE'
    });

    return {
      workforceHealthScore: metrics.workforceEfficiencyScore || 85,
      slaCompliance: metrics.slaCompliance || 100,
      utilizationRate: metrics.utilizationRate || 0,
      activeAgentsCount: metrics.activeAgents || 0,
      activeTasksCount: metrics.activeTasks || 0,
      isolatedEmployeesCount: risks.isolatedEmployees?.length || 0,
      knowledgeSilosCount: risks.knowledgeSilos?.length || 0,
      bottlenecksCount: risks.bottlenecks?.length || 0,
      retentionRisksCount: activeRetentionRisks,
      successorsCount,
      avgPipelineReadiness,
      topOpportunities,
      emergingRisks: [
        ...(risks.isolatedEmployees || []).map(e => ({ type: 'ISOLATED_NODE', title: `Isolated Agent: ${e.name}`, severity: 'MEDIUM' })),
        ...(risks.knowledgeSilos || []).map(s => ({ type: 'KNOWLEDGE_SILO', title: `Knowledge Silo in ${s.departmentName} (${s.siloAgentName})`, severity: 'HIGH' })),
        ...(risks.bottlenecks || []).map(b => ({ type: 'BOTTLENECK', title: `Communication Bottleneck: ${b.departmentName}`, severity: 'HIGH' }))
      ].slice(0, 5)
    };
  } catch (err) {
    console.error('Error generating executive insights:', err.message);
    throw err;
  }
};

module.exports = {
  calculateConfidenceScore,
  generateRecommendations,
  generateExecutiveInsights
};
