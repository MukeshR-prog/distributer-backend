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

---

## 4. Agent Analytics Dashboard UI Architecture

The frontend is integrated as a dedicated tab inside the Agent Console Dashboard. It leverages Next.js Client Components and responsive grids to render real-time performance analytics.

```mermaid
graph TD
    Dashboard["Agent Dashboard (page.js)"] -->|Mounts| Toolbar["AnalyticsToolbar.jsx"]
    Dashboard -->|Conditional Render| EmptyState["AnalyticsEmptyState.jsx"]
    Dashboard -->|Data Bind| ScoreCard["ProductivityScoreCard.jsx"]
    Dashboard -->|Data Bind| Breakdown["ProductivityBreakdown.jsx"]
    Breakdown -->|Grid Layout| Summary1["AnalyticsSummaryCard (Completion)"]
    Breakdown -->|Grid Layout| Summary2["AnalyticsSummaryCard (SLA)"]
    Breakdown -->|Grid Layout| Summary3["AnalyticsSummaryCard (Speed)"]
    Breakdown -->|Grid Layout| Summary4["AnalyticsSummaryCard (Count)"]
```

### Session Caching Flow
To reduce API request frequency, the dashboard stores response payloads locally:
1. **Cache Read**: On active tab transition or dashboard reload, the client checks `window.sessionStorage` under `agent_analytics_cache`.
2. **TTL Verification**: The cached payload is checked against a 5-minute TTL (Time-To-Live).
3. **Optimistic Loading**: If the cache is valid, the UI loads immediately.
4. **Background Refresh**: If the cache exists but is expired, it displays the cached data first, then triggers a background fetch to update the UI and rewrite the cache.
5. **Invalidation**: Clicking the "Refresh Metrics" action in `AnalyticsToolbar` bypasses the cache, forcing an API fetch.

---

## 5. Productivity KPI Rendering Flow

Metrics are calculated and rendered dynamically through specialized sub-components:
- **AnalyticsSkeleton**: Displays loading shells with pulsing animation.
- **ProductivityScoreCard**: Renders the final score and uses a gradient background matching the grade system (A+ = Emerald, A = Green, B = Blue, C = Amber, D = Red).
- **ProductivityBreakdown**: Configures a 2x2 grid containing four instances of `AnalyticsSummaryCard` representing Completion, SLA, Resolution Time, and Completed Counts. Displays trend indicator flags (▲ Improved, ▼ Declined, ▬ Stable) when comparative datasets are passed.
- **AnalyticsEmptyState**: Displays if the agent has not completed any tasks. Features an illustration and a "Go To Tasks" CTA to redirect back to the workspace queue.

## 6. Historical Performance Snapshot Cache

To prevent expensive recalculation of past performance indices (Productivity Score, SLA Compliance, Completion Rate, and Rank), the system utilizes a persistent snapshot layer (`AgentPerformanceSnapshot` model).
- **Auto-Generation**: During analytics request processing, the engine identifies any days/weeks in the target ranges lacking a snapshot and calculates them in-memory from past distribution history, then stores the snapshot in the database.
- **Normalizing Date Keys**: Snape dates (`generatedAt`) are normalized to Midnight (`00:00:00.000`) for robust uniqueness and cache lookup indexing.

---

## 7. Dynamic Ranking & Rank Movement

Agents are ranked against their workspace peers using a composite performance score:
$$RankScore = ProductivityScore + CompletionRate + SLACompliance$$

- **Global, Department, and Team Ranks**: The engine filters, orders, and ranks agents at the Global, Department, and Team levels.
- **Rank Movement**: The system compares current rank with rank 30 days ago, calculating rank direction (up/down/stable) and delta magnitude (e.g. `Moved up 4 positions`).
- **Leader Badges**: Rendered client-side on the `RankingCard` (e.g., `#1` in department triggers a `Department Leader` badge).

---

## 8. Trend Comparison Engine & Personal Bests

- **Overlay Comparison**: The `PerformanceTrendChart` visualizes current weekly/monthly lines alongside dashed lines representing previous period performance curves.
- **Personal Achievements**: An in-memory achievements engine calculates and lists peak scores, streak durations, best completion volumes, and speed records inside `PersonalBestCard`.

---

## 9. Adoption Auditing

Adoption statistics are logged directly into `ActivityLog` to analyze usage:
- `AGENT_ANALYTICS_VIEWED`: Emitted upon standard analytics page loads.
- `PERFORMANCE_REPORT_VIEWED`: Emitted when forcing manual refreshes (refresh button).

---

## 10. Agent Coaching Engine & Productivity Insights

The **Agent Coaching Engine** transforms raw analytical measurements into actionable recommendations and structured goals, implementing a premium personal coaching experience.

### AI Coaching Flow & Fallback Architecture
- **API Endpoint**: `GET /api/agent-ai/coaching`
- **AI Synthesis**: Leverages the Groq API service (`callGroq`) with a detailed system prompt defining strict schema formats. Inputs include historical trends, ranking movement, and productivity metrics.
- **Rule-Based Fallback**: If the AI request times out or returns malformed structures, the service triggers the fallback engine (`generateRuleBasedCoaching`) to generate custom rule-based insights dynamically. This ensures that the frontend never encounters rendering breaks.

### Coaching Snapshot Cache & Refresh Protection
- **Snapshot Persistence**: Generated coaching insights are stored inside `AgentCoachingSnapshot` to enable history tracking, and prevent redundant generation calls.
- **Smart Refresh Cooldown**: To protect against redundant LLM API rate limit hits, a `15-minute refresh cooldown` is enforced. Fresh calls are blocked during this window, and the cache is served directly from the database snapshot.

### Recommendation Action Tracking
- The system supports recommendation status updates (Complete, Save for Later, Dismiss) stored in `CoachingAction` collection.
- Statuses are merged dynamically into recommendation lists returned by the API.

### Goal Difficulty & Impact System
- Goals are saved as structured objects with difficulty ratings (`easy`, `medium`, `hard`) and estimated score impacts (e.g. `+15%`), mapping gamified targets dynamically.

### Coaching Impact Analytics & Weekly Timeline
- **ROI Impact Tracking**: The dashboard displays followed recommendations, achieved targets, and productivity score deltas as tangible coaching business value.
- **Weekly History Timeline**: Renders past weeks' snapshots in a vertical timeline, showing historical scores, summaries, and focus areas.

---

## 11. Agent Achievements & Gamification System

The **Agent Achievements & Gamification System** introduces leveling progression, reward points, dynamic streak calculations, and milestones badge unlocking to gamify operations.

### Experience (XP) & Point Scoring Engine
Points and experience are earned dynamically through operational activities:
- **Task Completion**: `+100 XP` and `+50 Points` per completed record.
- **On-Time SLA Completion**: `+50 XP` and `+20 Points` bonus per task completed on time.
- **Achievement Unlocked**: `+200 XP` and achievement-specific points (e.g. `+300` or `+500` Points) mapped from the definitions.

### Level Up & Tier Progression
Level is calculated from total accumulated XP using a linear threshold:
$$Level = \lfloor \frac{TotalXP}{1000} \rfloor + 1$$

- **Level Tiers**:
  - `Level 1-4`: Bronze Tier
  - `Level 5-9`: Silver Tier
  - `Level 10-14`: Gold Tier
  - `Level 15-19`: Platinum Tier
  - `Level 20+`: Diamond Tier
- When an agent crosses a level boundary, a `LEVEL_UP` event is registered in `ActivityLog`, and a Socket.IO event is broadcast to trigger UI celebrations.

### Daily Streaks Calculation
Streaks track consecutive days on which at least one distribution record was completed.
- **Algorithm**: Group completed records by local date ascending, sort, and look for differences of exactly 1 day.
- **Active State**: The streak is active if there is at least one completion today or yesterday. If both are missing, the current streak resets to `0`.

### Real-Time Live Feed Auditing
Achievement events trigger log entry records in the administrative database and feed alerts:
- `ACHIEVEMENT_UNLOCKED`: Emitted immediately upon crossing criteria thresholds.
- `LEVEL_UP`: Emitted upon crossing XP level boundaries.
- `STREAK_CREATED`: Tracks active streak expansion.
- Audits are pushed live to the CommandCenter's War Room feed and NotificationCenter via WebSocket emissions.

---

## 12. Agent Collaboration & Communication Hub

The **Agent Collaboration & Communication Hub** transforms the individual agent interface into a collaborative, real-time community hub, introducing Team Channels, Task Discussions, Shared Wikis, User Presence, and Team Announcements.

### Real-Time Sockets Channels & Messaging Engine
To support real-time chat without page reloads, a central Socket.IO setup is mounted in `server.js` and shared by the frontend dashboard.
- **Dynamic Seeding**: When an agent accesses channels, the system automatically checks for and seeds default communication channels (`General`, `Team <Name>`, `Department <Name>`) if they do not exist.
- **Socket Pipes**:
  - `join-channel` / `leave-channel`: Subscribes/unsubscribes client sockets to channel-specific rooms (`channel_<Id>`).
  - `send-message` / `edit-message` / `delete-message`: Transmits and broadcasts message additions, modifications, and deletions in real-time to active subscribers.
  - `typing` / `stop-typing`: Broadcasts typing animations when other agents type.
  - `message-read`: Updates message read receipts collection (`readBy` array) in MongoDB, broadcasting read status updates.

### Threaded Task Discussions & Resolution
- **Thread Schema**: `TaskDiscussion` stores comments, resolution statuses (`isResolved`, `resolvedBy`, `resolvedAt`), and nested replies for specific distribution record documents.
- **Feature**: Enables agents to converse within the scope of a task sheet, assign resolved statuses, and query active thread statuses dynamically.

### Collaborative Wiki Knowledge Base
- **SOP Storage**: The `SharedNote` collection persists titles, content tags, and categories of operational SOP articles created by agents.
- **Index Optimization**: Built-in regex indexing allows for full-text search matching across titles, categories, content body, and tags.

### User Presence Roster & Workspace Sync
- **Status Persistence**: The `User` model stores `presenceStatus` (`online`, `away`, `busy`, `offline`), `lastSeen` times, and `activeWorkspace` paths.
- **Connection Handlers**:
  - Upon Socket connection, the user is marked `online`, and a `presence-update` event is broadcast globally.
  - Upon active tab focus change, a `presence-change` event updates the user's `activeWorkspace` string (e.g., "Collaboration Hub", "Task Queue").
  - Upon Socket disconnect, the user is automatically marked `offline` with updated `lastSeen` values, broadcasting updates to all other agents.

### Scope-Restricted Announcement Feeds
- **Notice Management**: The `Announcement` collection stores low, medium, high, and critical bulletins targeting specific user groups (`global`, `team`, or `department`).
- **Feature**: Automatically filters notices based on the logged-in agent's attributes and tracks read receipts via `readBy` user ID arrays.

---

## 13. Agent AI Copilot & Smart Task Assistant

The **Agent AI Copilot & Smart Task Assistant** integrates a personalized AI assistant into the agent console, offering natural language support, risk-based prioritization columns, executable action links, follow-up generators, and local fallback engines.

### Chat Assistant & Conversation Lifecycle
- **Conversation State**: The `AgentCopilotSession` model stores chat thread lists. Pinned conversations are indexed to rank at the top of the list.
- **Operations**:
  - `rename`: Updates conversation titles dynamically.
  - `pin` / `unpin`: Toggles pinning flags.
  - `delete`: Removes session history.
- **Context Trimming & Token Protection**: The chat service dynamically trims prompt logs, keeping only the most recent messages to protect API limits and optimize latency.
- **Personalization Memory**: The `AgentCopilotPreference` model stores agent preferences (preferred hours, tasks, common coaching gaps) which are injected directly into the LLM system prompts.

### Smart Planner Recommendations & Risk Board
- **Prioritization Model**: Sorts active task records into High Risk, Due Today, and Overdue columns.
- **Actionable Execution Links**: Recommendations are deep-linked:
  - `Open`: Triggers tab switching and search filters for the specific record name.
  - `Start`: Triggers real-time task status updates.
  - `Follow-Up`: Invokes the AI follow-up generator.

### AI Follow-up & Communication Templates
- **Template Generation**: The `/api/agent-copilot/followup/:recordId` endpoint leverages Groq to synthesize scripts tailored for Email, Call scripts, WhatsApp messages, Meeting Invites, and Escalations based on specific record fields.
- **Local Fallback Rules**: If the LLM is unreachable, the engine falls back to local regex/template scripts to ensure continuous offline availability.

### Backend Performance Optimization
- **15-minute Caching Layer**: In-memory caching for summaries and recommendations queries reduces MongoDB processing overhead.
- **In-flight Deduplication**: Deduplicates concurrent duplicate requests, queuing requests into a single promise cache.

### Activity Logging & Auditing
- logs `COPILOT_CHAT_CREATED`, `COPILOT_RECOMMENDATION_USED`, `COPILOT_SUMMARY_GENERATED`, and `COPILOT_FOLLOWUP_GENERATED` to feed live alerts to the CommandCenter's War Room feed and NotificationCenter via Socket.IO.

---

## 14. Agent Learning Center & Career Growth Platform

The **Agent Learning Center & Career Growth Platform** establishes a comprehensive skill progression, verification licensing, and career tracking hub in the agent portal.

### Automatic Seeding & Syllabus Content
Upon database startup or first user access, the system checks for and creates default training courses in the database:
1. **Customer Communication** (Difficulty: Easy, Tag: Communication): Focuses on active listening and empathetic rapport. Includes a 2-question multiple-choice quiz.
2. **Task Management** (Difficulty: Easy, Tag: Operations): Teaches workload queue prioritization rules.
3. **SLA Excellence** (Difficulty: Medium, Tag: SLA): Explains breach avoidance thresholds and deadline tracking.
4. **Leadership Skills** (Difficulty: Hard, Tag: Management): Guides lead agents in operational coaching and mentoring.
5. **Productivity Optimization** (Difficulty: Medium, Tag: Productivity): Covers streak habits and daily consistency.
6. **AI Assisted Operations** (Difficulty: Medium, Tag: AI): Focuses on using the AI Copilot templates.

### Quiz Grading & Auto-Certification Logic
When an agent submits answers to a module quiz (`POST /api/learning/progress`), the system:
- Scores the responses against the correct answer keys in the database.
- If the score is $\ge 80\%$, the progress is updated to $100\%$ completion (`completedAt` is stored).
- If the score is $< 80\%$, the progress is updated to $50\%$ (started but failed).
- Upon reaching $100\%$ completion across all modules in a syllabus path, the system checks if a certification has already been issued:
  - If not, it creates a `Certification` record with a unique license code formatted as `CERT-<NORMALIZED-PATH-NAME>-<RANDOM-HEX>`.
  - Awards a `+500 XP` and `+250 Points` payout to the user, checks for level up boundaries, logs a `CERTIFICATION_EARNED` activity, and emits real-time WebSocket events.

### Career Progression & Tiers Evaluation
An agent's Career Tier is dynamically evaluated based on completed paths, user experience level, and productivity scores:
- **Associate Agent**: Baseline onboarding starter tier.
- **Professional Agent**: Completed $\ge 1$ Path and Productivity $\ge 75$.
- **Senior Agent**: Completed $\ge 2$ Paths and Productivity $\ge 80$.
- **Lead Agent**: Completed $\ge 3$ Paths, User Level $\ge 5$, and Productivity $\ge 85$.
- **Operations Specialist**: Completed $\ge 4$ Paths, User Level $\ge 10$, and Productivity $\ge 90$.
- **Operations Expert**: Completed $\ge 6$ Paths, User Level $\ge 15$, and Productivity $\ge 95$.

### Composite Growth Index & Skill Score
- **Skill Score**: Percentage of available learning paths completed:
  $$SkillScore = \frac{CompletedPaths}{TotalPaths} \times 100$$
- **Learning Velocity**: Percentage of available paths completed in the last 30 days.
- **Growth Index**: Composite metric summarizing overall progress:
  $$GrowthIndex = (SkillScore \times 0.3) + (StreakFactor \times 0.2) + (LevelFactor \times 0.2) + (ProductivityScore \times 0.3)$$
  Where $StreakFactor = \min(100, currentStreak \times 10)$ and $LevelFactor = \min(100, level \times 5)$.



