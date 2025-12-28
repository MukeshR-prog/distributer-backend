const User = require('../models/User');
const ChannelMessage = require('../models/ChannelMessage');
const TaskDiscussion = require('../models/TaskDiscussion');
const SharedNote = require('../models/SharedNote');
const OpportunityApplication = require('../models/OpportunityApplication');
const NetworkSnapshot = require('../models/NetworkSnapshot');

/**
 * Builds the collaboration graph analytics and communication metrics
 */
const analyzeCommunicationGraph = async () => {
  const users = await User.find({ role: 'agent', isActive: true });
  const userMap = new Map(users.map(u => [u._id.toString(), {
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    department: u.department || 'General Operations',
    team: u.team || 'Default Team',
    messagesSent: 0,
    mentionsReceived: 0,
    wikiCreated: 0,
    mentorshipCount: 0,
    interactions: 0
  }]));

  // 1. Channel Messages
  const messages = await ChannelMessage.find({});
  for (const msg of messages) {
    const senderId = msg.sender?.toString();
    if (userMap.has(senderId)) {
      userMap.get(senderId).messagesSent += 1;
      userMap.get(senderId).interactions += 1;
    }
    if (msg.mentions && msg.mentions.length > 0) {
      for (const mention of msg.mentions) {
        const mentionId = mention.toString();
        if (userMap.has(mentionId)) {
          userMap.get(mentionId).mentionsReceived += 1;
          userMap.get(mentionId).interactions += 1;
        }
      }
    }
  }

  // 2. Task Discussions
  const discussions = await TaskDiscussion.find({});
  for (const disc of discussions) {
    const senderId = disc.sender?.toString();
    if (userMap.has(senderId)) {
      userMap.get(senderId).messagesSent += 1;
      userMap.get(senderId).interactions += 1;
    }
    if (disc.mentions && disc.mentions.length > 0) {
      for (const mention of disc.mentions) {
        const mentionId = mention.toString();
        if (userMap.has(mentionId)) {
          userMap.get(mentionId).mentionsReceived += 1;
          userMap.get(mentionId).interactions += 1;
        }
      }
    }
    // Replies
    if (disc.replies && disc.replies.length > 0) {
      for (const rep of disc.replies) {
        const repSenderId = rep.sender?.toString();
        if (userMap.has(repSenderId)) {
          userMap.get(repSenderId).messagesSent += 1;
          userMap.get(repSenderId).interactions += 1;
        }
        if (rep.mentions && rep.mentions.length > 0) {
          for (const mention of rep.mentions) {
            const mentionId = mention.toString();
            if (userMap.has(mentionId)) {
              userMap.get(mentionId).mentionsReceived += 1;
              userMap.get(mentionId).interactions += 1;
            }
          }
        }
      }
    }
  }

  // 3. Knowledge Base SOPs
  const sops = await SharedNote.find({});
  for (const sop of sops) {
    const creatorId = sop.createdBy?.toString();
    if (userMap.has(creatorId)) {
      userMap.get(creatorId).wikiCreated += 1;
      userMap.get(creatorId).interactions += 1;
    }
  }

  // 4. Mentorship Opportunities
  // Query opportunity applications for MENTORSHIP or LEADERSHIP categories that are ACCEPTED
  const applications = await OpportunityApplication.find({ status: 'ACCEPTED' })
    .populate('opportunityId');
  for (const app of applications) {
    const agentId = app.agentId?.toString();
    const opt = app.opportunityId;
    if (opt && (opt.category === 'MENTORSHIP' || opt.category === 'LEADERSHIP')) {
      if (userMap.has(agentId)) {
        userMap.get(agentId).mentorshipCount += 1;
        userMap.get(agentId).interactions += 1;
      }
    }
  }

  // Calculate influence score per agent
  const influencerList = [];
  let totalInteractions = 0;

  for (const [id, profile] of userMap.entries()) {
    // Suitability Influence Formula:
    // msg * 0.2 + mentions * 0.3 + wiki * 5 * 0.3 + mentor * 10 * 0.2
    const rawInfluence = (profile.messagesSent * 0.2) + 
                         (profile.mentionsReceived * 0.3) + 
                         (profile.wikiCreated * 1.5) + 
                         (profile.mentorshipCount * 2.0);
    
    // Scale or normalize score to realistic 10-100 range
    profile.influenceScore = Math.max(15, Math.min(100, Math.round(15 + rawInfluence)));
    totalInteractions += profile.interactions;
    influencerList.push(profile);
  }

  const density = users.length > 0 ? Number((totalInteractions / users.length).toFixed(2)) : 0;

  return {
    agents: influencerList,
    density,
    totalInteractions
  };
};

/**
 * Identifies key contributors from calculated parameters
 */
const identifyKeyContributors = async () => {
  const { agents } = await analyzeCommunicationGraph();
  
  // Sort and pick top contributors
  const topCollaborators = [...agents].sort((a, b) => b.messagesSent - a.messagesSent).slice(0, 5);
  const knowledgeLeaders = [...agents].sort((a, b) => b.wikiCreated - a.wikiCreated).slice(0, 5);
  const communicationChampions = [...agents].sort((a, b) => b.mentionsReceived - a.mentionsReceived).slice(0, 5);
  const mentorshipLeaders = [...agents].sort((a, b) => b.mentorshipCount - a.mentorshipCount).slice(0, 5);

  return {
    topCollaborators,
    knowledgeLeaders,
    communicationChampions,
    mentorshipLeaders
  };
};

/**
 * Identifies risks like isolated employees, knowledge silos, and department bottlenecks
 */
const identifyOrganizationalRisks = async () => {
  const { agents } = await analyzeCommunicationGraph();
  
  // Isolated Employees: active users with 0 or very low interactions
  const isolatedEmployees = agents.filter(a => a.interactions === 0);
  const lowEngagementUsers = agents.filter(a => a.interactions > 0 && a.interactions < 4);

  // Knowledge Silos: Departments where >= 80% of wikis are created by a single agent
  const sops = await SharedNote.find({}).populate('createdBy');
  const deptWikiMap = {};
  
  for (const sop of sops) {
    if (!sop.createdBy) continue;
    const dept = sop.createdBy.department || 'General Operations';
    const userId = sop.createdBy._id.toString();
    const name = sop.createdBy.name;

    if (!deptWikiMap[dept]) {
      deptWikiMap[dept] = { total: 0, users: {} };
    }
    deptWikiMap[dept].total += 1;
    deptWikiMap[dept].users[userId] = (deptWikiMap[dept].users[userId] || 0) + 1;
    deptWikiMap[dept].userNames = deptWikiMap[dept].userNames || {};
    deptWikiMap[dept].userNames[userId] = name;
  }

  const knowledgeSilos = [];
  for (const [dept, data] of Object.entries(deptWikiMap)) {
    if (data.total < 3) continue; // Skip departments with very few articles
    for (const [userId, count] of Object.entries(data.users)) {
      const percentage = (count / data.total) * 100;
      if (percentage >= 80) {
        knowledgeSilos.push({
          departmentName: dept,
          siloAgentId: userId,
          siloAgentName: data.userNames[userId],
          sopCount: count,
          departmentTotal: data.total,
          ratio: Number(percentage.toFixed(1))
        });
      }
    }
  }

  // Bottleneck indicators: departments with very low interaction volumes relative to user count
  const deptUserCounts = {};
  const deptInteractions = {};
  
  agents.forEach(a => {
    deptUserCounts[a.department] = (deptUserCounts[a.department] || 0) + 1;
    deptInteractions[a.department] = (deptInteractions[a.department] || 0) + a.interactions;
  });

  const bottlenecks = [];
  for (const dept of Object.keys(deptUserCounts)) {
    const userCount = deptUserCounts[dept];
    const totalInter = deptInteractions[dept];
    const density = totalInter / userCount;
    if (userCount >= 3 && density < 1.5) {
      bottlenecks.push({
        departmentName: dept,
        userCount,
        totalInteractions: totalInter,
        density: Number(density.toFixed(2))
      });
    }
  }

  return {
    isolatedEmployees,
    lowEngagementUsers,
    knowledgeSilos,
    bottlenecks
  };
};

/**
 * Returns dynamic network health snapshots
 */
const generateNetworkHealth = async () => {
  const { agents, density } = await analyzeCommunicationGraph();
  const risks = await identifyOrganizationalRisks();

  // Collaboration Score: based on average interactions across agents
  const totalInteractions = agents.reduce((acc, a) => acc + a.interactions, 0);
  const avgInteractions = agents.length > 0 ? totalInteractions / agents.length : 0;
  const collaborationScore = Math.max(25, Math.min(100, Math.round(30 + avgInteractions * 3.5)));

  // Engagement Score: percentage of agents who actively communicate (at least 3 interactions)
  const activeCount = agents.filter(a => a.interactions >= 3).length;
  const engagementScore = agents.length > 0 ? Math.round((activeCount / agents.length) * 100) : 80;

  // Knowledge Flow Score: based on total wiki contributions and mentorships
  const totalSops = await SharedNote.countDocuments({});
  const totalMentorships = await OpportunityApplication.countDocuments({ status: 'ACCEPTED' });
  const knowledgeFlowScore = Math.max(30, Math.min(100, Math.round(40 + (totalSops * 2.5) + (totalMentorships * 4))));

  // Network Health Score = (Collab * 0.35) + (Engage * 0.35) + (KnowledgeFlow * 0.30)
  const networkHealth = Math.round((collaborationScore * 0.35) + (engagementScore * 0.35) + (knowledgeFlowScore * 0.30));

  // Compile Department Metrics
  const deptsMap = {};
  agents.forEach(a => {
    if (!deptsMap[a.department]) {
      deptsMap[a.department] = { count: 0, interactions: 0 };
    }
    deptsMap[a.department].count += 1;
    deptsMap[a.department].interactions += a.interactions;
  });

  const departmentMetrics = Object.entries(deptsMap).map(([deptName, d]) => ({
    departmentName: deptName,
    communicationDensity: d.count > 0 ? Number((d.interactions / d.count).toFixed(2)) : 0,
    collaborationVolume: d.interactions
  }));

  // Create database snapshot log
  const snapshot = await NetworkSnapshot.create({
    collaborationScore,
    knowledgeFlowScore,
    engagementScore,
    influenceScore: networkHealth, // We map Network Health onto overall average influence
    departmentMetrics,
    riskMetrics: {
      isolatedUsersCount: risks.isolatedEmployees.length,
      knowledgeSilosCount: risks.knowledgeSilos.length,
      communicationBottlenecksCount: risks.bottlenecks.length
    }
  });

  return {
    networkHealth,
    collaborationScore,
    engagementScore,
    knowledgeFlowScore,
    snapshot
  };
};

/**
 * Seeding or retrieving dynamic team-to-team interaction matrices
 */
const getTeamConnectivityMatrix = async () => {
  const users = await User.find({ role: 'agent', isActive: true });
  const depts = [...new Set(users.map(u => u.department || 'General Operations'))];

  // We fetch channel messages and task comments that have mentions
  // and map their sender/recipient department connections
  const matrix = {};
  
  // Initialize
  depts.forEach(d1 => {
    matrix[d1] = {};
    depts.forEach(d2 => {
      // Default baseline collaboration index
      matrix[d1][d2] = d1 === d2 ? 85 : 25; 
    });
  });

  const messages = await ChannelMessage.find({}).populate('sender');
  for (const msg of messages) {
    if (!msg.sender) continue;
    const senderDept = msg.sender.department || 'General Operations';
    
    if (msg.mentions && msg.mentions.length > 0) {
      for (const mention of msg.mentions) {
        const recipient = await User.findById(mention);
        if (recipient) {
          const recipDept = recipient.department || 'General Operations';
          if (matrix[senderDept] && matrix[senderDept][recipDept] !== undefined) {
            matrix[senderDept][recipDept] += 4;
            // Cap at 100 max
            if (matrix[senderDept][recipDept] > 100) matrix[senderDept][recipDept] = 100;
          }
        }
      }
    }
  }

  // Compile formatted matrix list for the Heatmap component
  const dataList = [];
  depts.forEach(d1 => {
    depts.forEach(d2 => {
      dataList.push({
        source: d1,
        target: d2,
        weight: matrix[d1][d2]
      });
    });
  });

  return {
    departments: depts,
    matrix: dataList
  };
};

module.exports = {
  analyzeCommunicationGraph,
  identifyKeyContributors,
  identifyOrganizationalRisks,
  generateNetworkHealth,
  getTeamConnectivityMatrix
};
