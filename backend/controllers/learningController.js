const asyncHandler = require('express-async-handler');
const LearningPath = require('../models/LearningPath');
const LearningModule = require('../models/LearningModule');
const AgentLearningProgress = require('../models/AgentLearningProgress');
const Certification = require('../models/Certification');
const { evaluatePathCertification } = require('../services/careerGrowthEngine');

// Default courses configuration to seed
const DEFAULT_PATHS = [
  {
    name: "Customer Communication",
    description: "Master client-facing interactions, script optimizations, and empathetic follow-up communications.",
    difficulty: "easy",
    estimatedHours: 2,
    tags: ["Communication", "Customer Relations"],
    modules: [
      {
        title: "Active Listening & Engagement",
        description: "Core principles of active listening, asking discovery questions, and building rapport.",
        content: "Active listening is the foundation of excellent service. By fully concentrating, understanding, responding, and remembering what client contacts say, you establish strong operational relationships.",
        durationMinutes: 15,
        order: 0,
        quiz: [
          {
            question: "Which of the following is a primary technique of active listening?",
            options: ["Interrupting to give quick advice", "Paraphrasing and repeating key details back to the client", "Checking email in another window"],
            correctAnswerIndex: 1
          },
          {
            question: "True or False: Asking open-ended questions helps clarify customer bottlenecks.",
            options: ["True", "False"],
            correctAnswerIndex: 0
          }
        ]
      }
    ]
  },
  {
    name: "Task Management",
    description: "Learn systematic ways to organize distribution queue records and clear bottlenecks.",
    difficulty: "easy",
    estimatedHours: 3,
    tags: ["Operations", "Workload"],
    modules: [
      {
        title: "Queue Prioritization Strategies",
        description: "How to use critical priorities and due dates to organize your workspace queue.",
        content: "Prioritization means working on tasks that provide the highest immediate resolution value. By ordering tasks by severity and SLA approaching thresholds, you prevent backlog bottlenecks.",
        durationMinutes: 20,
        order: 0,
        quiz: [
          {
            question: "When sorting a task list, which items should generally be completed first?",
            options: ["The oldest tasks without dates", "Critical priority items near SLA expiration", "The easiest tasks"],
            correctAnswerIndex: 1
          }
        ]
      }
    ]
  },
  {
    name: "SLA Excellence",
    description: "Understand SLA compliance guidelines, warning alerts, and rescue procedures.",
    difficulty: "medium",
    estimatedHours: 4,
    tags: ["SLA", "Compliance"],
    modules: [
      {
        title: "Avoiding SLA Breaches",
        description: "Proactive warnings tracking, deadlines calculations, and escalation protocols.",
        content: "SLA compliance requires resolving tasks within predefined timeframes. Standard SLA targets are 24 hours. Keep close track of Approach warning indicators to prevent breaches.",
        durationMinutes: 30,
        order: 0,
        quiz: [
          {
            question: "What is the typical resolution SLA threshold target in this console system?",
            options: ["12 Hours", "24 Hours", "72 Hours"],
            correctAnswerIndex: 1
          }
        ]
      }
    ]
  },
  {
    name: "Leadership Skills",
    description: "Build team mentoring skills, escalation management strategies, and operation oversight.",
    difficulty: "hard",
    estimatedHours: 5,
    tags: ["Management", "Leadership"],
    modules: [
      {
        title: "Operational Leadership",
        description: "Guiding operations, helping teammates resolve stuck tasks, and organizing rosters.",
        content: "Leadership is not just a title; it is action. Lead agents help analyze performance trends, optimize coaching areas, and coordinate seasonal leaderboards rewards.",
        durationMinutes: 45,
        order: 0,
        quiz: [
          {
            question: "As a Lead Agent, how can you best support a teammate struggling with SLA targets?",
            options: ["Tell them to work faster", "Review their AI Coaching snapshots and recommend specific learning paths", "Ignore it"],
            correctAnswerIndex: 1
          }
        ]
      }
    ]
  },
  {
    name: "Productivity Optimization",
    description: "Techniques to maximize completion rates and maintain daily active streaks.",
    difficulty: "medium",
    estimatedHours: 3,
    tags: ["Productivity", "Gamification"],
    modules: [
      {
        title: "Streak Mastery & Habits",
        description: "Building consistent daily resolution habits to unlock progression rewards.",
        content: "Consistency beats intensity. Maintaining a consecutive daily task resolution streak unlocks XP multiplier rewards and points to redeem titles in the Store.",
        durationMinutes: 15,
        order: 0,
        quiz: [
          {
            question: "How is an active consecutive completion streak maintained?",
            options: ["By working 24 hours straight once a week", "By completing at least one task record today or yesterday", "By visiting the profile tab"],
            correctAnswerIndex: 1
          }
        ]
      }
    ]
  },
  {
    name: "AI Assisted Operations",
    description: "Leverage AI Copilot summaries, smart planners, and follow-up templates to speed up operations.",
    difficulty: "medium",
    estimatedHours: 2,
    tags: ["AI", "Copilot"],
    modules: [
      {
        title: "Leveraging the Copilot",
        description: "How to use chat assistant history, smart recommendations execution, and copy script templates.",
        content: "The AI Copilot operates as your personal assistant. By requesting summaries, risk analysis, and drafting whatsapp/email script templates, you can reduce resolution speeds.",
        durationMinutes: 15,
        order: 0,
        quiz: [
          {
            question: "Which feature of the AI Copilot helps save time drafting client messages?",
            options: ["The Seasonal Leaderboard podium", "The AI Follow-Up script template generator", "The radial progress ring"],
            correctAnswerIndex: 1
          }
        ]
      }
    ]
  }
];

/**
 * Helper to dynamically seed default courses if none exist.
 */
const seedLearningContent = async () => {
  const count = await LearningPath.countDocuments();
  if (count > 0) return;

  console.log("🌱 Seeding default learning paths and modules...");
  for (const pathData of DEFAULT_PATHS) {
    const path = await LearningPath.create({
      name: pathData.name,
      description: pathData.description,
      difficulty: pathData.difficulty,
      estimatedHours: pathData.estimatedHours,
      tags: pathData.tags
    });

    for (const modData of pathData.modules) {
      await LearningModule.create({
        pathId: path._id,
        title: modData.title,
        description: modData.description,
        content: modData.content,
        durationMinutes: modData.durationMinutes,
        order: modData.order,
        quiz: modData.quiz
      });
    }
  }
  console.log("✅ Seed completed successfully!");
};

/**
 * @desc    Get All Learning Paths with progress status
 * @route   GET /api/learning/paths
 * @access  Private (Agent Only)
 */
const getLearningPaths = asyncHandler(async (req, res) => {
  await seedLearningContent();
  const agentId = req.user._id.toString();

  const paths = await LearningPath.find();
  const progressList = await AgentLearningProgress.find({ agentId });
  const certifications = await Certification.find({ agentId });

  // Map progress by pathId
  const progressMap = new Map();
  progressList.forEach(p => {
    if (!progressMap.has(p.pathId.toString())) {
      progressMap.set(p.pathId.toString(), []);
    }
    progressMap.get(p.pathId.toString()).push(p);
  });

  const certMap = new Set(certifications.map(c => c.pathId.toString()));

  const result = [];
  for (const path of paths) {
    const modules = await LearningModule.find({ pathId: path._id }).sort({ order: 1 });
    const modProgress = progressMap.get(path._id.toString()) || [];
    
    // Calculate path completion percentage
    const totalModules = modules.length;
    let completedCount = 0;
    let timeSpent = 0;
    
    const modulesDetails = modules.map(m => {
      const prog = modProgress.find(p => p.moduleId.toString() === m._id.toString());
      const isCompleted = prog && prog.completionPercentage === 100;
      if (isCompleted) completedCount++;
      if (prog) timeSpent += (prog.timeSpent || 0);

      return {
        id: m._id,
        title: m.title,
        description: m.description,
        durationMinutes: m.durationMinutes,
        order: m.order,
        isCompleted: !!isCompleted,
        quizScore: prog ? prog.quizScore : 0
      };
    });

    const completionPercentage = totalModules > 0 ? Math.round((completedCount / totalModules) * 100) : 0;
    const isCertified = certMap.has(path._id.toString());

    result.push({
      id: path._id,
      name: path.name,
      description: path.description,
      difficulty: path.difficulty,
      estimatedHours: path.estimatedHours,
      tags: path.tags,
      completionPercentage,
      timeSpent,
      isCertified,
      modules: modulesDetails
    });
  }

  res.status(200).json({
    success: true,
    paths: result
  });
});

/**
 * @desc    Get Learning Module content and quiz details
 * @route   GET /api/learning/modules/:id
 * @access  Private (Agent Only)
 */
const getLearningModuleDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const agentId = req.user._id.toString();

  const module = await LearningModule.findById(id).populate('pathId');
  if (!module) {
    return res.status(404).json({ success: false, message: "Module not found" });
  }

  const progress = await AgentLearningProgress.findOne({ agentId, moduleId: id });

  res.status(200).json({
    success: true,
    module: {
      id: module._id,
      pathId: module.pathId._id,
      pathName: module.pathId.name,
      title: module.title,
      description: module.description,
      content: module.content,
      durationMinutes: module.durationMinutes,
      quiz: module.quiz.map(q => ({
        question: q.question,
        options: q.options
      })) // Omit correct answer to client
    },
    progress: progress ? {
      completionPercentage: progress.completionPercentage,
      quizScore: progress.quizScore,
      completedAt: progress.completedAt
    } : null
  });
});

/**
 * @desc    Record/Update Module Learning Progress and Evaluate Quizzes
 * @route   POST /api/learning/progress
 * @access  Private (Agent Only)
 */
const recordLearningProgress = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const { moduleId, answers = [], timeSpent = 5 } = req.body;
  const io = req.app.get('io');

  if (!moduleId) {
    return res.status(400).json({ success: false, message: "moduleId is required" });
  }

  const module = await LearningModule.findById(moduleId);
  if (!module) {
    return res.status(404).json({ success: false, message: "Learning module not found" });
  }

  // Evaluate quiz if answers are passed
  let quizScore = 0;
  let completionPercentage = 100; // Completed on submit by default if quiz passes
  
  if (module.quiz && module.quiz.length > 0) {
    let correctCount = 0;
    module.quiz.forEach((q, index) => {
      const selectedIndex = answers[index];
      if (selectedIndex !== undefined && Number(selectedIndex) === q.correctAnswerIndex) {
        correctCount++;
      }
    });
    quizScore = Math.round((correctCount / module.quiz.length) * 100);
    
    // Quiz passing threshold is 80%
    if (quizScore < 80) {
      completionPercentage = 50; // Started but failed quiz
    }
  }

  const updateFields = {
    pathId: module.pathId,
    completionPercentage,
    quizScore,
    $inc: { timeSpent: Number(timeSpent) }
  };

  if (completionPercentage === 100) {
    updateFields.completedAt = new Date();
  }

  const progress = await AgentLearningProgress.findOneAndUpdate(
    { agentId, moduleId },
    updateFields,
    { new: true, upsert: true }
  );

  // Check if this path is now fully completed to issue certifications
  let certification = null;
  let certUnlocked = false;
  if (completionPercentage === 100) {
    const certResult = await evaluatePathCertification(agentId, module.pathId, io);
    if (certResult.unlocked) {
      certification = certResult.certification;
      certUnlocked = true;
    }
  }

  res.status(200).json({
    success: true,
    progress: {
      moduleId: progress.moduleId,
      completionPercentage: progress.completionPercentage,
      quizScore: progress.quizScore,
      completedAt: progress.completedAt
    },
    quizPassed: completionPercentage === 100,
    quizScore,
    certUnlocked,
    certification
  });
});

/**
 * @desc    Get Overall Agent Learning & Career Statistics
 * @route   GET /api/learning/progress
 * @access  Private (Agent Only)
 */
const getLearningStatistics = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  
  const progressList = await AgentLearningProgress.find({ agentId });
  const certifications = await Certification.find({ agentId }).populate('pathId');

  const totalStartedPaths = new Set(progressList.map(p => p.pathId.toString())).size;
  const completedModules = progressList.filter(p => p.completionPercentage === 100).length;
  
  let totalTimeSpent = 0;
  progressList.forEach(p => {
    totalTimeSpent += (p.timeSpent || 0);
  });

  const certsInfo = certifications.map(c => ({
    id: c._id,
    title: c.title,
    code: c.code,
    issuedAt: c.issuedAt,
    pathName: c.pathId.name
  }));

  // Fetch Career Growth engine stats
  const { calculateAgentCareerStats } = require('../services/careerGrowthEngine');
  const careerStats = await calculateAgentCareerStats(agentId);

  res.status(200).json({
    success: true,
    totalStartedPaths,
    completedModules,
    totalTimeSpentHours: Math.round((totalTimeSpent / 60) * 10) / 10,
    certifications: certsInfo,
    ...careerStats
  });
});

/**
 * @desc    Get/Generate Career Development Plan
 * @route   GET /api/learning/development-plan
 * @access  Private (Agent Only)
 */
const getDevelopmentPlan = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const io = req.app.get('io');

  const { generateDevelopmentPlan } = require('../services/developmentPlanner');
  const plan = await generateDevelopmentPlan(agentId, false, io);

  res.status(200).json({
    success: true,
    plan
  });
});

/**
 * @desc    Force Regenerate Career Development Plan
 * @route   POST /api/learning/regenerate-plan
 * @access  Private (Agent Only)
 */
const regenerateDevelopmentPlan = asyncHandler(async (req, res) => {
  const agentId = req.user._id.toString();
  const io = req.app.get('io');

  const { generateDevelopmentPlan } = require('../services/developmentPlanner');
  const plan = await generateDevelopmentPlan(agentId, true, io);

  res.status(200).json({
    success: true,
    plan
  });
});

module.exports = {
  getLearningPaths,
  getLearningModuleDetails,
  recordLearningProgress,
  getLearningStatistics,
  getDevelopmentPlan,
  regenerateDevelopmentPlan
};
