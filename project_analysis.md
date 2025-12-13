# Project Analysis: Agent Analytics Foundation

This document details the analysis and design of the Agent Analytics Backend Foundation, including calculations, formulas, database indexing, and API structure.

---

## 1. Agent Analytics Service

The **Agent Analytics Service** is a reusable calculation module built inside [agentPerformanceEngine.js](file:///d:/mern/distributer/backend/services/agentPerformanceEngine.js). It aggregates user assignments and performs non-blocking calculations to retrieve:
1. **Completion Metrics**: The number of assigned, completed, and pending records, alongside the overall completion rate.
2. **SLA Compliance**: Evaluates tasks against their due dates to check compliance.
3. **Resolution Metrics**: Evaluates duration (in hours) between initial assignment (`assignedAt`) and completion (`completedAt` or `updatedAt`).

### Database Queries & Aggregation
To maintain performance:
- The service queries the `Distribution` schema using indexing on `agents.agentId`:
  ```javascript
  const distributions = await Distribution.find({ 'agents.agentId': agentId });
  ```
- Reusable arrays of records are filtered locally using JavaScript array operations to avoid multiple heavy round-trips to MongoDB.

---

## 2. Productivity Score Engine

The Productivity Score Engine calculates a consolidated score from 0 to 100 representing an agent's overall performance.

### Weighted Formula
The score is calculated using the following weights:
- **Completion Rate**: `40%`
- **SLA Compliance**: `35%`
- **Activity Participation**: `15%`
- **Resolution Speed**: `10%`

$$ProductivityScore = (CompletionRate \times 0.40) + (SLACompliance \times 0.35) + (ActivityParticipation \times 0.15) + (ResolutionSpeed \times 0.10)$$

### Metrics Evaluation Details:
1. **Completion Rate**: Percentage of assigned records marked as `completed`.
2. **SLA Compliance**: Percentage of completed tasks that were completed before or on their `dueDate`. Completed tasks without a due date are considered on time. Defaults to `100` if no tasks are completed.
3. **Activity Participation**: Based on the agent's interaction frequency. Checked via `ActivityLog` entries where `performedBy` matches the agent within the last 30 days. Benchmark: 30 logged events in 30 days = 100%.
4. **Resolution Speed Score**: Based on the `averageResolutionHours`:
   - $\le 2$ hours: `100`
   - $\le 6$ hours: `90`
   - $\le 12$ hours: `80`
   - $\le 24$ hours: `70`
   - $\le 48$ hours: `50`
   - $> 48$ hours: `30`
   - No completed tasks: `100` (Optimal default)

### Grading Schema:
- **A+**: $\ge 95$
- **A**: $\ge 90$
- **B**: $\ge 80$
- **C**: $\ge 70$
- **D**: $< 70$

---

## 3. Agent Analytics API

The Agent Analytics API exposes calculated metrics to the agent portal.

### Endpoint Specifications
- **URL**: `GET /api/agent-workspace/analytics`
- **Auth**: Protected (Requires valid JWT token in `Authorization: Bearer <token>`)
- **Role Permissions**: Restricted to `agent` role.
- **Cache Policy**: 5-minute memory caching on the server side to minimize MongoDB query load during frequent page reloads.

### Sample API Response Payload
```json
{
  "success": true,
  "cached": false,
  "productivity": {
    "score": 92,
    "grade": "A"
  },
  "completionMetrics": {
    "totalAssigned": 15,
    "completed": 12,
    "pending": 3,
    "completionRate": 80
  },
  "slaMetrics": {
    "onTimeCompleted": 10,
    "lateCompleted": 2,
    "slaCompliance": 83
  },
  "resolutionMetrics": {
    "averageResolutionHours": 4.5,
    "fastestResolutionHours": 1.2,
    "slowestResolutionHours": 18.4
  }
}
```
