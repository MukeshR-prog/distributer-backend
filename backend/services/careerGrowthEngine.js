const LearningPath = require('../models/LearningPath');
const LearningModule = require('../models/LearningModule');
const AgentLearningProgress = require('../models/AgentLearningProgress');
const Certification = require('../models/Certification');
const User = require('../models/User');
const { logActivity } = require('../utils/activityLogger');
const { calculateProductivityScore } = require('./agentPerformanceEngine');

/**
 * Evaluates whether an agent has completed all modules in a path with a quiz score >= 80%.
 * If so, automatically issues a Certification and awards XP/Points.
 * @param {String} agentId - User ID of the agent
 * @param {String} pathId - LearningPath ID
 * @param {Object} [io] - Express Socket.IO instance
 * @returns {Promise<Object>} Unlocked status and certification document if newly created
 */
const evaluatePathCertification = async (agentId, pathId, io = null) => {
  try {
    const path = await LearningPath.findById(pathId);
    if (!path) return { unlocked: false, certification: null };

    const modules = await LearningModule.find({ pathId });
    if (modules.length === 0) return { unlocked: false, certification: null };

    // Get progress records for this agent
    const progressRecords = await AgentLearningProgress.find({ agentId, pathId });

    // Verify all modules are completed with quiz score >= 80%
    const allCompleted = modules.every(m => {
      const prog = progressRecords.find(p => p.moduleId.toString() === m._id.toString());
      return prog && prog.completionPercentage === 100 && prog.quizScore >= 80;
    });

    if (!allCompleted) {
      return { unlocked: false, certification: null };
    }

    // Check if certification already exists
    let certification = await Certification.findOne({ agentId, pathId });
    if (certification) {
      return { unlocked: false, certification };
    }

    // Generate certification code: CERT-PATHNAME-HEX
    const pathNameNormalized = path.name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toUpperCase();
    const certCode = `CERT-${pathNameNormalized}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Create certification
    certification = await Certification.create({
      agentId,
      pathId,
      title: `Certification in ${path.name}`,
      code: certCode,
      passingScore: 80
    });

    // Award rewards (XP/Points)
    const user = await User.findById(agentId);
    if (user) {
      const oldLevel = user.level || 1;
      user.xp += 500;
      user.points += 250;
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
    }

    // Log activity for certification earned
    await logActivity({
      actionType: 'CERTIFICATION_EARNED',
      entityType: 'Certification',
      entityId: certification._id,
      userId: agentId,
      metadata: {
        certificationId: certification._id,
        title: certification.title,
        code: certification.code,
        pathName: path.name
      }
    }, io);

    // Emit socket event
    if (io) {
      io.emit('certificationEarned', {
        agentId,
        title: certification.title,
        code: certification.code,
        pathName: path.name
      });
    }

    return { unlocked: true, certification };
  } catch (error) {
    console.error('⚠️ Error in evaluatePathCertification:', error.message);
    return { unlocked: false, certification: null };
  }
};

/**
 * Calculates career statistics and evaluates career tier progression for an agent.
 * @param {String} agentId - User ID of the agent
 * @returns {Promise<Object>} Career statistics
 */
const calculateAgentCareerStats = async (agentId) => {
  try {
    const user = await User.findById(agentId);
    if (!user) {
      return {
        skillScore: 0,
        careerLevel: "Associate Agent",
        certificationScore: 0,
        learningVelocity: 0,
        growthIndex: 0
      };
    }

    // 1. Get Certifications
    const certs = await Certification.find({ agentId });
    const completedPathsCount = certs.length;

    // 2. Skill Score (Percentage of completed paths out of total paths available)
    const totalPathsCount = await LearningPath.countDocuments();
    const skillScore = totalPathsCount > 0 ? Math.round((completedPathsCount / totalPathsCount) * 100) : 0;

    // 3. Learning Velocity (Percentage of paths completed in the last 30 days out of total paths available)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const certsLast30Days = await Certification.countDocuments({ agentId, issuedAt: { $gte: thirtyDaysAgo } });
    const learningVelocity = totalPathsCount > 0 ? Math.round((certsLast30Days / totalPathsCount) * 100) : 0;

    // 4. Productivity Score
    const prodResult = await calculateProductivityScore(agentId);
    const productivityScore = prodResult.score || 0;

    // 5. Career Tier Evaluation
    let careerLevel = "Associate Agent";
    if (completedPathsCount >= 6 && user.level >= 15 && productivityScore >= 95) {
      careerLevel = "Operations Expert";
    } else if (completedPathsCount >= 4 && user.level >= 10 && productivityScore >= 90) {
      careerLevel = "Operations Specialist";
    } else if (completedPathsCount >= 3 && user.level >= 5 && productivityScore >= 85) {
      careerLevel = "Lead Agent";
    } else if (completedPathsCount >= 2 && productivityScore >= 80) {
      careerLevel = "Senior Agent";
    } else if (completedPathsCount >= 1 && productivityScore >= 75) {
      careerLevel = "Professional Agent";
    }

    // 6. Growth Index (Composite metric out of 100)
    const streakFactor = Math.min(100, user.currentStreak * 10);
    const levelFactor = Math.min(100, user.level * 5);
    const growthIndex = Math.round(
      (skillScore * 0.3) +
      (streakFactor * 0.2) +
      (levelFactor * 0.2) +
      (productivityScore * 0.3)
    );

    return {
      skillScore,
      careerLevel,
      certificationScore: completedPathsCount * 100, // 100 points per certification
      learningVelocity,
      growthIndex
    };
  } catch (error) {
    console.error('⚠️ Error in calculateAgentCareerStats:', error.message);
    return {
      skillScore: 0,
      careerLevel: "Associate Agent",
      certificationScore: 0,
      learningVelocity: 0,
      growthIndex: 0
    };
  }
};

module.exports = {
  evaluatePathCertification,
  calculateAgentCareerStats
};
