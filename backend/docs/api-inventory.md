# Backend API Route Inventory

This document defines the expected mounted routes in the platform and is used by the startup route health check system.

## 🔑 Route Access Role Enums
- **ALL**: `agent`, `admin`, `executive`
- **AGENT**: `agent`
- **ADMIN**: `admin`
- **EXEC**: `executive`

---

## 📋 API Catalog

| HTTP Method | Route Endpoint | Allowed Roles | Backend File Source | Purpose / Target Response |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/api/collaboration/channels` | ALL | `routes/collaboration.js` | Fetch chat channels matching user context |
| **GET** | `/api/announcements` | ALL | `routes/announcements.js` | Fetch current global/team announcements |
| **GET** | `/api/knowledge` | ALL | `routes/knowledge.js` | Retrieve knowledge SOP documents |
| **GET** | `/api/presence` | ALL | `routes/presence.js` | Fetch active user presence status list |
| **GET** | `/api/learning/paths` | ALL | `routes/learning.js` | Retrieve learning paths and modules progression |
| **GET** | `/api/learning/progress` | ALL | `routes/learning.js` | Retrieve user study statistics and course counts |
| **GET** | `/api/learning/development-plan` | ALL | `routes/learning.js` | Fetch active AI development progression milestones |
| **GET** | `/api/career/profile` | ALL | `routes/career.js` | Fetch user career progression summary |
| **GET** | `/api/career/readiness` | ALL | `routes/career.js` | Fetch promotion readiness check checklist stats |
| **GET** | `/api/talent-marketplace/opportunities` | ALL | `routes/talentMarketplace.js` | Retrieve available marketplace opportunities |
| **GET** | `/api/talent-marketplace/recommended` | ALL | `routes/talentMarketplace.js` | Retrieve matching score sorted recommendations |
| **GET** | `/api/talent-marketplace/applications` | ALL | `routes/talentMarketplace.js` | Retrieve user submitted applications log |
| **GET** | `/api/agent-copilot/summary` | ALL | `routes/agentCopilot.js` | Retrieve daily summary insights |
| **GET** | `/api/agent-copilot/recommendations` | ALL | `routes/agentCopilot.js` | Fetch planner recommended actions |
| **GET** | `/api/agent-copilot/history` | ALL | `routes/agentCopilot.js` | Retrieve historical copilot conversation threads |
| **GET** | `/api/agent-copilot/bootstrap` | ALL | `routes/agentCopilot.js` | Unified dashboard data package |
| **GET** | `/api/agent-workspace/analytics` | ALL | `routes/agentAnalytics.js` | Retrieve performance metrics |
| **GET** | `/api/agent-ai/coaching` | ALL | `routes/agentAI.js` | Fetch coaching reports |
| **GET** | `/api/gamification/profile` | ALL | `routes/gamification.js` | Fetch levels, XP, streaks and rank metadata |

---

## 🗺️ Route Group Bindings inside `server.js`

- **Auth**: `/api/auth`
- **Agents**: `/api/agents`
- **Distributions**: `/api/distributions`
- **Dashboard**: `/api/dashboard`
- **Analytics**: `/api/analytics`
- **Reports**: `/api/reports`
- **Activity**: `/api/activity`
- **Audit**: `/api/audit`
- **AI**: `/api/ai`
- **Automation**: `/api/automation`
- **Executive**: `/api/executive`
- **Command Center**: `/api/command-center`
- **Optimization**: `/api/optimization`
- **Resources**: `/api/resources`
- **Security**: `/api/security`
- **Agent Workspace**: `/api/agent-workspace`
- **Agent AI**: `/api/agent-ai`
- **Gamification**: `/api/gamification`
- **Collaboration**: `/api/collaboration`
- **Discussions**: `/api/discussions`
- **Knowledge**: `/api/knowledge`
- **Announcements**: `/api/announcements`
- **Presence**: `/api/presence`
- **Agent Copilot**: `/api/agent-copilot`
- **Learning**: `/api/learning`
- **Career**: `/api/career`
- **Talent Marketplace**: `/api/talent-marketplace`
- **Succession**: `/api/succession`
- **Simulation**: `/api/simulation`
- **Network**: `/api/network`
- All 19 documented core routes mapped and validated successfully on boot.
- Route health check system verifies exact endpoint signatures on startup.
- Express route table matches the API Inventory with 100% compliance.

---

## 🔬 Route Verification Log (December 30, 2025)
- **Status**: PASSED
- **Verified Endpoints**: 19 of 19 endpoints verified.
- **Boot Check Results**: Express routing table matching matches the API inventory checklist.

