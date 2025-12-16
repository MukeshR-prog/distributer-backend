const User = require('../models/User');
const AgentCoachingSnapshot = require('../models/AgentCoachingSnapshot');
const { callGroq } = require('./groqService');
const {
  calculateProductivityScore,
  calculateCompletionMetrics,
  calculateSLAMetrics,
  calculateAgentRanking,
  calculateWeeklyTrend,
  calculateMonthlyTrend,
  calculateImprovementMetrics
} = require('./agentPerformanceEngine');

const SYSTEM_PROMPT = `You are a personal operational AI coach for a Distribution Management System.
Analyze the provided agent analytics and performance metrics, and generate actionable, encouraging, data-driven coaching insights.
Your response MUST be a single, valid JSON object matching the following JSON schema:
{
  "summary": "string",         // Clear summary overview of performance trends, coaching feedback, and achievements (2-3 sentences)
  "strengths": ["string"],      // Array of 2-3 specific performance strengths (e.g. 'Consistent resolution speed under 4 hours')
  "weaknesses": ["string"],     // Array of 2-3 areas for improvement (e.g. 'SLA compliance dropped by 5% this week')
  "recommendations": ["string"], // Array of 2-3 prioritized priority recommendations (e.g. 'Focus on high-priority tickets first')
  "nextGoals": [               // Array of 2-3 concrete goals for next week
    {
      "goal": "string",
      "difficulty": "easy" | "medium" | "hard",
      "estimatedImpact": number // estimated percentage improvement in productivity score (e.g. 15 for 15% estimated improvement)
    }
  ],
  "confidence": "high" | "medium" | "low", // AI assessment confidence level of current metrics
  "focusArea": "string",       // The single most critical area for the agent to focus on (e.g., 'Reduce overdue tasks')
  "motivationMessage": "string" // A personalized encouraging motivation message based on accomplishments
}
Ensure the output is pure JSON. Do not include any markdown, explanation wrappers, or extra text.`;

const getUserPrompt = (agentName, metrics) => {
  return `Agent Name: ${agentName}
Metrics:
- Productivity Score: ${metrics.score} (Grade: ${metrics.grade})
- Completion Rate: ${metrics.completionRate}% (${metrics.completed} of ${metrics.totalAssigned} tasks)
- SLA Compliance: ${metrics.slaCompliance}% (${metrics.onTimeCompleted} completed on time)
- Rankings:
  - Global Rank: #${metrics.ranking.globalRank} (of ${metrics.ranking.totalAgents})
  - Department Rank: #${metrics.ranking.departmentRank}
  - Team Rank: #${metrics.ranking.teamRank}
- Improvement Metrics (past 30 days):
  - Score Delta: ${metrics.improvement.improvementPercent}% (${metrics.improvement.direction === 'up' ? 'improved' : 'declined'})
  - Rank Movement: ${metrics.improvement.rankMovement} positions (${metrics.improvement.rankMovementDirection === 'up' ? 'improved/moved up' : 'declined/dropped'})
- Weekly Trend (Last 7 days of completed tasks):
  ${JSON.stringify(metrics.weeklyTrend.slice(-7))}
- Monthly Trend (Weekly scores):
  ${JSON.stringify(metrics.monthlyTrend)}

Analyze this data and generate the JSON coaching insights object matching the required schema exactly. Make recommendations highly specific to these metrics.`;
};

// Generates fallback coaching dataset using standard rule-based evaluation
const generateRuleBasedCoaching = (metrics) => {
  const strengths = [];
  if (metrics.score >= 90) {
    strengths.push(`Excellent overall productivity score of ${metrics.score}%`);
  } else if (metrics.score >= 80) {
    strengths.push(`Consistent productivity output at ${metrics.score}%`);
  } else {
    strengths.push("Steady progress on assigned distribution tasks");
  }

  if (metrics.slaCompliance >= 90) {
    strengths.push(`Strong SLA compliance of ${metrics.slaCompliance}%`);
  } else if (metrics.slaCompliance >= 75) {
    strengths.push(`Good SLA compliance holding at ${metrics.slaCompliance}%`);
  }

  if (metrics.completionRate >= 80) {
    strengths.push(`High task completion rate (${metrics.completionRate}%)`);
  }

  if (strengths.length < 2) {
    strengths.push("Consistent daily activity participation");
    strengths.push("Committed task handling and progress updates");
  }

  const weaknesses = [];
  if (metrics.slaCompliance < 80) {
    weaknesses.push(`SLA Compliance is below standard at ${metrics.slaCompliance}%`);
  }
  if (metrics.completionRate < 70) {
    weaknesses.push(`Completion Rate can be optimized (currently ${metrics.completionRate}%)`);
  }
  if (metrics.improvement.direction === 'down' && metrics.improvement.improvementPercent > 0) {
    weaknesses.push(`Recent performance trend shows minor decline of ${metrics.improvement.improvementPercent}% in score`);
  }
  if (weaknesses.length === 0) {
    weaknesses.push("Opportunities exist to further reduce resolution speed");
    weaknesses.push("Potential to increase activity interaction frequency");
  }

  const recommendations = [];
  if (metrics.slaCompliance < 80) {
    recommendations.push("Prioritize upcoming SLA deadlines to minimize overdue tasks");
  }
  if (metrics.completionRate < 80) {
    recommendations.push("Focus on transitioning pending tasks to in-progress daily");
  }
  if (metrics.improvement.direction === 'up' && metrics.improvement.rankMovement > 0) {
    recommendations.push("Maintain current positive momentum to secure a higher rank");
  }
  if (recommendations.length < 2) {
    recommendations.push("Review critical priority items at the start of each shift");
    recommendations.push("Consistently log resolution notes for team visibility");
  }

  const nextGoals = [];
  if (metrics.slaCompliance < 95) {
    nextGoals.push({
      goal: "Achieve 95% SLA compliance rate",
      difficulty: "medium",
      estimatedImpact: 10
    });
  } else {
    nextGoals.push({
      goal: "Maintain perfect 100% SLA compliance",
      difficulty: "easy",
      estimatedImpact: 5
    });
  }

  const nextCompletedTarget = Math.max(15, Math.ceil((metrics.completed || 0) * 1.2));
  nextGoals.push({
    goal: `Complete at least ${nextCompletedTarget} tasks`,
    difficulty: nextCompletedTarget > 30 ? "hard" : "medium",
    estimatedImpact: 15
  });

  if (metrics.ranking.globalRank > 3) {
    nextGoals.push({
      goal: `Reach Top 3 global ranking (currently #${metrics.ranking.globalRank})`,
      difficulty: "hard",
      estimatedImpact: 20
    });
  } else {
    nextGoals.push({
      goal: "Maintain rank position in top tier leaderboard",
      difficulty: "medium",
      estimatedImpact: 8
    });
  }

  const trendText = metrics.improvement.direction === 'up'
    ? `Your productivity increased by ${metrics.improvement.improvementPercent}% recently.`
    : `Your productivity score is currently holding at ${metrics.score}%.`;
  const rankText = metrics.improvement.rankMovement > 0
    ? ` You successfully moved up ${metrics.improvement.rankMovement} positions in the rankings.`
    : "";
  const summary = `${trendText}${rankText} Keep focusing on prompt resolution and SLA deadlines to elevate your performance grade.`;

  const focusArea = metrics.slaCompliance < 80
    ? "SLA Compliance & Deadlines"
    : metrics.completionRate < 75
      ? "Task Completion Rates"
      : "Resolution Speed & Efficiency";

  const motivationMessage = metrics.improvement.direction === 'up' && metrics.improvement.improvementPercent > 0
    ? `Outstanding effort! You improved your productivity by ${metrics.improvement.improvementPercent}% recently. Keep this momentum going!`
    : "Consistency is key. Focus on standard workflows and maintaining SLA guidelines to rise through the leaderboards.";

  return {
    summary,
    strengths,
    weaknesses,
    recommendations,
    nextGoals,
    confidence: 'low',
    focusArea,
    motivationMessage
  };
};

const generateAgentCoaching = async (agentId) => {
  const agent = await User.findById(agentId);
  if (!agent) {
    throw new Error('Agent user not found');
  }

  const [
    prod,
    completion,
    sla,
    ranking,
    weekly,
    monthly,
    improvement
  ] = await Promise.all([
    calculateProductivityScore(agentId),
    calculateCompletionMetrics(agentId),
    calculateSLAMetrics(agentId),
    calculateAgentRanking(agentId),
    calculateWeeklyTrend(agentId),
    calculateMonthlyTrend(agentId),
    calculateImprovementMetrics(agentId)
  ]);

  const metrics = {
    score: prod.score,
    grade: prod.grade,
    completed: completion.completed,
    totalAssigned: completion.totalAssigned,
    completionRate: completion.completionRate,
    onTimeCompleted: sla.onTimeCompleted,
    slaCompliance: sla.slaCompliance,
    ranking,
    weeklyTrend: weekly,
    monthlyTrend: monthly,
    improvement
  };

  let coachingResult = null;

  try {
    const systemPrompt = SYSTEM_PROMPT;
    const userPrompt = getUserPrompt(agent.name, metrics);
    
    const aiResult = await callGroq(systemPrompt, userPrompt);
    
    if (
      aiResult &&
      typeof aiResult.summary === 'string' &&
      Array.isArray(aiResult.strengths) &&
      Array.isArray(aiResult.weaknesses) &&
      Array.isArray(aiResult.recommendations) &&
      Array.isArray(aiResult.nextGoals)
    ) {
      // Map AI goals schema if formatted differently
      const formattedGoals = aiResult.nextGoals.map(g => {
        if (typeof g === 'string') {
          return { goal: g, difficulty: 'medium', estimatedImpact: 10 };
        }
        return {
          goal: g.goal || 'Improve task completion metrics',
          difficulty: g.difficulty || 'medium',
          estimatedImpact: typeof g.estimatedImpact === 'number' ? g.estimatedImpact : 10
        };
      });

      const recsWithIds = aiResult.recommendations.map((text, idx) => ({
        id: `rec_${Date.now()}_${idx}`,
        text
      }));

      coachingResult = {
        summary: aiResult.summary,
        strengths: aiResult.strengths,
        weaknesses: aiResult.weaknesses,
        recommendations: recsWithIds,
        goals: formattedGoals,
        confidence: aiResult.confidence || 'high',
        focusArea: aiResult.focusArea || 'General Operational Performance',
        motivationMessage: aiResult.motivationMessage || 'Keep pushing for operational excellence!',
        source: 'ai'
      };
    } else {
      throw new Error('AI output structure invalid');
    }
  } catch (error) {
    console.warn(`[CoachingEngine] AI generation failed, using rule-based fallback: ${error.message}`);
    const ruleBased = generateRuleBasedCoaching(metrics);
    
    const recsWithIds = ruleBased.recommendations.map((text, idx) => ({
      id: `rec_${Date.now()}_${idx}`,
      text
    }));

    coachingResult = {
      summary: ruleBased.summary,
      strengths: ruleBased.strengths,
      weaknesses: ruleBased.weaknesses,
      recommendations: recsWithIds,
      goals: ruleBased.nextGoals,
      confidence: 'low',
      focusArea: ruleBased.focusArea,
      motivationMessage: ruleBased.motivationMessage,
      source: 'fallback'
    };
  }

  // Persist snapshot to database
  const snapshot = await AgentCoachingSnapshot.create({
    agentId,
    productivityScore: metrics.score,
    ranking,
    strengths: coachingResult.strengths,
    weaknesses: coachingResult.weaknesses,
    recommendations: coachingResult.recommendations,
    goals: coachingResult.goals,
    summary: coachingResult.summary,
    source: coachingResult.source,
    confidence: coachingResult.confidence,
    focusArea: coachingResult.focusArea,
    motivationMessage: coachingResult.motivationMessage
  });

  return snapshot;
};

module.exports = {
  generateAgentCoaching
};
