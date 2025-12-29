const LearningCourse = require('../models/LearningCourse');
const CourseEnrollment = require('../models/CourseEnrollment');
const Certification = require('../models/Certification');
const User = require('../models/User');
const AgentCoachingSnapshot = require('../models/AgentCoachingSnapshot');
const CareerProgressionSnapshot = require('../models/CareerProgressionSnapshot');
const SuccessionCandidate = require('../models/SuccessionCandidate');
const { logActivity } = require('../utils/activityLogger');

const DEFAULT_COURSES = [
  {
    title: "Operations Workflow Mastery",
    description: "Master distribution operational queues, work order prioritizing, and logistics dispatch safety protocols.",
    category: "Operations",
    difficulty: "Intermediate",
    durationHours: 4,
    skills: ["Basic Operations", "Queue Prioritization", "Task Management"],
    prerequisites: [],
    pointsReward: 150,
    certificationEnabled: true
  },
  {
    title: "Empathetic Client Communication",
    description: "Learn strategies for client-facing interactions, handling critical escalations, and empathy-driven contact script writing.",
    category: "Communication",
    difficulty: "Beginner",
    durationHours: 2,
    skills: ["Customer Communication", "Client Interaction", "Active Engagement"],
    prerequisites: [],
    pointsReward: 100,
    certificationEnabled: true
  },
  {
    title: "Executive Leadership & Mentorship",
    description: "Advanced training modules on leadership presence, conflict resolution, roster operations, and mentoring junior agents.",
    category: "Leadership",
    difficulty: "Advanced",
    durationHours: 6,
    skills: ["Leadership Skills", "Operational Coaching", "Operational Mentoring", "Escalation Coordination"],
    prerequisites: [],
    pointsReward: 250,
    certificationEnabled: true
  },
  {
    title: "SLA Rescue & Customer Support",
    description: "Focus on active ticket queues approaching breaches, emergency backup protocols, and SLA threshold optimizations.",
    category: "Customer Service",
    difficulty: "Intermediate",
    durationHours: 3,
    skills: ["SLA Excellence", "SLA Rescue Procedures", "SLA Breach Prevention"],
    prerequisites: [],
    pointsReward: 120,
    certificationEnabled: true
  },
  {
    title: "Distribution Queue Analytics",
    description: "Deep dive into performance analytics data metrics, tracking team velocity, and optimizing dispatch loads.",
    category: "Analytics",
    difficulty: "Advanced",
    durationHours: 5,
    skills: ["Queue Analysis", "Workload Planning", "Productivity Optimization"],
    prerequisites: [],
    pointsReward: 200,
    certificationEnabled: true
  },
  {
    title: "Enterprise Change Management",
    description: "Understand organizational transformations, department restructuring patterns, and operational team readiness.",
    category: "Management",
    difficulty: "Intermediate",
    durationHours: 4,
    skills: ["Resource Optimization", "Roster Organizing", "Change Management"],
    prerequisites: [],
    pointsReward: 180,
    certificationEnabled: true
  },
  {
    title: "AI Assisted Queue Operations",
    description: "Master modern AI toolkits, prompt configurations, using Copilot script shortcuts, and automated record processing.",
    category: "Technical",
    difficulty: "Intermediate",
    durationHours: 3,
    skills: ["AI Assisted Operations", "AI Operations Champion", "AI Copilot Utilization"],
    prerequisites: [],
    pointsReward: 150,
    certificationEnabled: true
  }
];

/**
 * Seed initial LMS courses if none exist in the database.
 */
const seedDefaultCourses = async () => {
  try {
    const count = await LearningCourse.countDocuments();
    if (count > 0) return;

    console.log("🌱 Seeding default courses in Learning Management System...");
    await LearningCourse.create(DEFAULT_COURSES);
    console.log("✅ Seeding of LMS courses completed successfully.");
  } catch (error) {
    console.error("⚠️ Error seeding default courses:", error.message);
  }
};

/**
 * Calculates overall learning progression index out of 100.
 */
const calculateLearningScore = async (userId) => {
  try {
    const totalCoursesCount = await LearningCourse.countDocuments();
    if (totalCoursesCount === 0) return 0;

    const completedCount = await CourseEnrollment.countDocuments({
      userId,
      status: 'COMPLETED'
    });

    const score = Math.round((completedCount / totalCoursesCount) * 100);
    return Math.min(100, Math.max(0, score));
  } catch (error) {
    console.error("Error in calculateLearningScore:", error.message);
    return 0;
  }
};

/**
 * Recommends courses matching agent gaps (Coaching, Career Snapshot, Succession Candidates).
 */
const recommendCourses = async (userId) => {
  try {
    await seedDefaultCourses();

    const [coaching, career, succession, enrollments] = await Promise.all([
      AgentCoachingSnapshot.findOne({ agentId: userId }).sort({ generatedAt: -1 }),
      CareerProgressionSnapshot.findOne({ agentId: userId }).sort({ generatedAt: -1 }),
      SuccessionCandidate.findOne({ agentId: userId }).sort({ generatedAt: -1 }),
      CourseEnrollment.find({ userId })
    ]);

    const completedOrActive = new Set(
      enrollments
        .filter(e => e.status === 'COMPLETED' || e.status === 'IN_PROGRESS')
        .map(e => e.courseId.toString())
    );

    const allCourses = await LearningCourse.find({});
    const uncompletedCourses = allCourses.filter(c => !completedOrActive.has(c._id.toString()));

    const recommendations = [];

    // Identify Gaps
    const missingSkills = new Set();
    const recommendedCategories = new Set();

    if (coaching && coaching.weaknesses) {
      coaching.weaknesses.forEach(w => {
        const text = (typeof w === 'string' ? w : w.text || '').toLowerCase();
        if (text.includes('communication') || text.includes('client')) {
          recommendedCategories.add('Communication');
        }
        if (text.includes('sla') || text.includes('deadline')) {
          recommendedCategories.add('Customer Service');
        }
        if (text.includes('productivity') || text.includes('operations')) {
          recommendedCategories.add('Operations');
        }
        if (text.includes('lead') || text.includes('mentor')) {
          recommendedCategories.add('Leadership');
        }
      });
    }

    if (career) {
      if (career.missingSkills) {
        career.missingSkills.forEach(s => missingSkills.add(s));
      }
      if (career.recommendedCertifications) {
        career.recommendedCertifications.forEach(cert => {
          const lowerCert = cert.toLowerCase();
          if (lowerCert.includes('communication')) recommendedCategories.add('Communication');
          if (lowerCert.includes('sla') || lowerCert.includes('excellence')) recommendedCategories.add('Customer Service');
          if (lowerCert.includes('leadership')) recommendedCategories.add('Leadership');
          if (lowerCert.includes('productivity')) recommendedCategories.add('Operations');
        });
      }
    }

    if (succession) {
      const role = (succession.targetRole || '').toLowerCase();
      if (role.includes('lead') || role.includes('mentor') || role.includes('coordinator')) {
        recommendedCategories.add('Leadership');
        recommendedCategories.add('Management');
      }
    }

    // Process uncompleted courses and compile priority recommendations
    for (const course of uncompletedCourses) {
      let score = 0;
      let reason = "Expand your foundational distribution system knowledge.";
      let priority = 'LOW';

      // 1. Matches Category
      if (recommendedCategories.has(course.category)) {
        score += 30;
        reason = `Targets your active improvement area in ${course.category}.`;
        priority = 'MEDIUM';
      }

      // 2. Matches Skills Gaps
      const matchingSkills = course.skills.filter(s => missingSkills.has(s));
      if (matchingSkills.length > 0) {
        score += 40;
        reason = `Acquires missing skills required for career growth: ${matchingSkills.join(', ')}.`;
        priority = 'HIGH';
      }

      // 3. Succession specific check
      if (succession && (course.category === 'Leadership' || course.category === 'Management')) {
        score += 20;
        reason = `Prepares you for the upcoming leadership target transition to ${succession.targetRole || 'Mentor'}.`;
        priority = 'HIGH';
      }

      recommendations.push({
        course,
        reason,
        priority,
        score
      });
    }

    // Sort by recommendation score
    recommendations.sort((a, b) => b.score - a.score);

    // Return top 3 recommendations
    return recommendations.slice(0, 3);
  } catch (error) {
    console.error("Error recommending courses:", error.message);
    return [];
  }
};

/**
 * Creates certification license records.
 */
const generateCertification = async (userId, courseId, score) => {
  try {
    const course = await LearningCourse.findById(courseId);
    if (!course) throw new Error("Course not found");

    // Check if certification already exists
    let cert = await Certification.findOne({ userId, courseId });
    if (cert) return cert;

    const certNumber = `CERT-${course.category.toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 2); // Valid for 2 years

    cert = await Certification.create({
      userId,
      agentId: userId, // compatibility alias
      courseId,
      title: `Certification in ${course.title}`,
      certificateNumber: certNumber,
      code: certNumber, // compatibility alias
      passingScore: 80, // compatibility alias
      score,
      expiresAt,
      issuedAt: new Date()
    });

    return cert;
  } catch (error) {
    console.error("Error in generateCertification:", error.message);
    throw error;
  }
};

/**
 * Calculates skill progression score vector (Communication, Leadership, Operations, Analytics, Customer Service)
 */
const calculateSkillGrowth = async (userId) => {
  try {
    const completedEnrollments = await CourseEnrollment.find({
      userId,
      status: 'COMPLETED'
    }).populate('courseId');

    const skillsMap = {
      Communication: 20, // base baseline score
      Leadership: 20,
      Operations: 20,
      Analytics: 20,
      'Customer Service': 20
    };

    completedEnrollments.forEach(enrollment => {
      const course = enrollment.courseId;
      if (!course) return;

      const category = course.category;
      
      // Accumulate completion boosts
      if (category === 'Communication') {
        skillsMap['Communication'] = Math.min(100, skillsMap['Communication'] + 30);
      } else if (category === 'Leadership' || category === 'Management') {
        skillsMap['Leadership'] = Math.min(100, skillsMap['Leadership'] + 30);
      } else if (category === 'Operations') {
        skillsMap['Operations'] = Math.min(100, skillsMap['Operations'] + 30);
      } else if (category === 'Analytics' || category === 'Technical') {
        skillsMap['Analytics'] = Math.min(100, skillsMap['Analytics'] + 30);
      } else if (category === 'Customer Service') {
        skillsMap['Customer Service'] = Math.min(100, skillsMap['Customer Service'] + 30);
      }
    });

    return skillsMap;
  } catch (error) {
    console.error("Error in calculateSkillGrowth:", error.message);
    return {
      Communication: 20,
      Leadership: 20,
      Operations: 20,
      Analytics: 20,
      'Customer Service': 20
    };
  }
};

/**
 * Dynamic triggers to refresh Career progression plans.
 */
const updateCareerReadiness = async (userId) => {
  try {
    const { generateCareerRoadmap } = require('./careerProgressionEngine');
    await generateCareerRoadmap(userId, true).catch(err => {
      console.warn("⚠️ Career roadmap regeneration error:", err.message);
    });
  } catch (err) {
    console.error("Failed to require/update career roadmap:", err.message);
  }
};

/**
 * Dynamic triggers to update Succession planning pipelines.
 */
const updateSuccessionEligibility = async (userId) => {
  try {
    const { identifyHighPotentialEmployees } = require('./successionEngine');
    await identifyHighPotentialEmployees(true, null).catch(err => {
      console.warn("⚠️ Succession eligibility regeneration error:", err.message);
    });
  } catch (err) {
    console.error("Failed to require/update succession eligibility:", err.message);
  }
};

module.exports = {
  seedDefaultCourses,
  calculateLearningScore,
  recommendCourses,
  generateCertification,
  calculateSkillGrowth,
  updateCareerReadiness,
  updateSuccessionEligibility
};
