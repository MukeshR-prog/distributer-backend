/**
 * AI Prompts for the Operations Coaching Assistant
 */

const SYSTEM_PROMPT = `You are an expert operations coaching assistant for a Distribution Management System.
Analyze the provided operational data and generate actionable, data-driven insights.

Your response MUST be a single, valid JSON object matching the following JSON schema:
{
  "confidence": number, // an integer between 0 and 100 indicating confidence level in recommendations based on data quality
  "summary": "string",  // clear summary of findings
  "reasoning": "string", // explanation behind the confidence rating and conclusions
  "recommendations": [  // array of actionable improvements
    {
      "recommendation": "string", // what action to take (e.g. 'Reassign 10 tasks from Agent X to Agent Y')
      "reason": "string",         // explanation of why this is needed
      "supportingMetrics": {      // key metric key-value pairs backing this recommendation
        "metricName1": "value1",
        ...
      },
      "priority": "High" | "Medium" | "Low"
    }
  ]
}

Ensure the output is pure JSON. Do not include any markdown, explanation wrapper, or extra text.`;

const getInsightsPrompt = (metrics) => {
  return {
    system: SYSTEM_PROMPT,
    user: `Analyze the following team-wide operational metrics:
- Active Agents: ${metrics.activeAgents}
- Total Tasks Assigned: ${metrics.totalTasks}
- Completed Tasks: ${metrics.completedTasks}
- Pending Tasks: ${metrics.pendingTasks}
- In Progress Tasks: ${metrics.inProgressTasks}
- Failed Tasks: ${metrics.failedTasks}
- Average Completion Rate: ${metrics.averageCompletionRate}%
- Team Average Risk Score: ${metrics.averageRiskScore}%
- Critical Risk Agents Count: ${metrics.criticalRiskCount}
- Impending SLA Breaches (under 24h): ${metrics.upcomingSLABreaches}

Provide a comprehensive Team Performance Summary, SLA Health Summary, Workload Health Summary, and Risk Assessment Summary inside the 'summary' and 'reasoning' fields. Include at least 3 prioritized, explainable recommendations with specific details and supporting metrics.`
  };
};

const getCoachingPrompt = (agentName, metrics) => {
  return {
    system: SYSTEM_PROMPT,
    user: `Analyze the following operational metrics for agent '${agentName}':
- Total Tasks Assigned: ${metrics.totalAssigned}
- Completed Tasks: ${metrics.completedTasks}
- Overdue Tasks: ${metrics.overdueTasks}
- Approaching Breach (under 24h): ${metrics.approachingTasks}
- Critical Active Tasks: ${metrics.criticalActive}
- High Active Tasks: ${metrics.highActive}
- SLA Breach Probability: ${metrics.slaBreachProbability}%
- Escalation Risk Index: ${metrics.escalationRisk}%
- Capacity Overload Risk: ${metrics.agentOverloadRisk}%
- Task Distribution Risk: ${metrics.distributionRisk}%
- Overall Risk Score: ${metrics.riskScore}%
- Performance Grade: ${metrics.grade} (Score: ${metrics.performanceScore})
- Average Resolution Time: ${metrics.averageResolutionTime} hours
- Activity Participation Rate: ${metrics.activityParticipationRate}%

Provide a comprehensive coaching review including the agent's strengths, weaknesses, and improvement suggestions in the 'summary' and 'reasoning' fields. Provide at least 2 specific, explainable recommendations containing action items (e.g., reassigning tasks, training suggestions, or priority adjustments) with supporting metrics.`
  };
};

const getExecutiveSummaryPrompt = (metrics) => {
  return {
    system: SYSTEM_PROMPT,
    user: `Analyze these high-level enterprise distribution metrics:
- Total Active Agents: ${metrics.activeAgents}
- Total Workload Tasks: ${metrics.totalTasks}
- Team SLA Compliance Average: ${metrics.averageSLACompliance}%
- Team Average Completion Rate: ${metrics.averageCompletionRate}%
- Team Average Performance Score: ${metrics.teamAverageScore}
- Total Critical SLA Breach Warnings: ${metrics.upcomingSLABreaches}
- Overloaded Agents: ${metrics.overloadedCount} (out of ${metrics.activeAgents})

Generate a strategic, concise Executive Summary weekly overview. Detail key system-wide risks and propose executive resource-level and process-level recommendations with high-quality supporting metrics.`
  };
};

module.exports = {
  getInsightsPrompt,
  getCoachingPrompt,
  getExecutiveSummaryPrompt
};
