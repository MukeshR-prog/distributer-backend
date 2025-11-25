const SecurityEvent = require('../models/SecurityEvent');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

/**
 * @desc    Runs a comprehensive rules-based security analysis
 * @returns {Promise<Object>} security score, alerts list, recommendations
 */
const runThreatAnalysis = async () => {
  const now = new Date();
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const alerts = [];
  const recommendations = [];

  // 1. Detect Repeated Login Failures
  const loginFailures = await SecurityEvent.find({
    eventType: 'Login Failure',
    createdAt: { $gte: twelveHoursAgo }
  });

  const failureGroupsByEmail = {};
  const failureGroupsByIP = {};

  loginFailures.forEach(event => {
    const email = event.metadata?.email || 'unknown';
    const ip = event.metadata?.ipAddress || 'unknown';

    failureGroupsByEmail[email] = (failureGroupsByEmail[email] || 0) + 1;
    failureGroupsByIP[ip] = (failureGroupsByIP[ip] || 0) + 1;
  });

  // Flag emails with excessive failures
  Object.keys(failureGroupsByEmail).forEach(email => {
    if (email !== 'unknown' && failureGroupsByEmail[email] >= 3) {
      alerts.push({
        id: `brute_email_${email}`,
        type: 'Brute Force Attempt',
        title: 'Repeated Login Failures (User Target)',
        description: `User account ${email} had ${failureGroupsByEmail[email]} failed login attempts in the last 12 hours.`,
        severity: 'high',
        timestamp: now
      });

      recommendations.push({
        id: `rec_lock_${email}`,
        title: `Verify and temporarily suspend user ${email}`,
        description: 'Repeated authorization attempts could indicate credential stuffing. Recommend confirming the owner identity.',
        targetUser: email
      });
    }
  });

  // Flag IPs with excessive failures
  Object.keys(failureGroupsByIP).forEach(ip => {
    if (ip !== 'unknown' && failureGroupsByIP[ip] >= 5) {
      alerts.push({
        id: `brute_ip_${ip}`,
        type: 'IP Blocking Warning',
        title: 'Repeated Login Failures (Source IP)',
        description: `Source IP ${ip} originated ${failureGroupsByIP[ip]} failed login attempts in the last 12 hours.`,
        severity: 'critical',
        timestamp: now
      });

      recommendations.push({
        id: `rec_block_ip_${ip}`,
        title: `Restrict traffic from IP ${ip}`,
        description: 'Originating IP address is showing automated brute force patterns. Consider configuring firewall restrictions.',
        targetUser: 'System'
      });
    }
  });

  // 2. Detect Suspicious Activity (Deactivated user login attempts)
  const deactivatedAttempts = loginFailures.filter(e => e.metadata?.reason === 'Account deactivated');
  if (deactivatedAttempts.length > 0) {
    alerts.push({
      id: 'suspicious_deactivated_login',
      type: 'Suspicious Login Attempt',
      title: 'Login to Deactivated Account',
      description: `Detected ${deactivatedAttempts.length} login attempts to deactivated agent accounts in the last 12 hours.`,
      severity: 'high',
      timestamp: now
    });

    recommendations.push({
      id: 'rec_deactivated_audit',
      title: 'Audit client access keys',
      description: 'Access tokens or client sessions of deactivated users may still be active. Re-verify API credentials.',
      targetUser: 'System'
    });
  }

  // 3. Detect Excessive Permission Changes
  const permChanges = await SecurityEvent.find({
    eventType: { $in: ['Permission Changes', 'Role Updates'] },
    createdAt: { $gte: twentyFourHoursAgo }
  });

  if (permChanges.length >= 5) {
    alerts.push({
      id: 'excessive_perm_changes',
      type: 'Privilege Escalation Warning',
      title: 'Excessive Permission Changes',
      description: `Detected ${permChanges.length} permission or role modifications in the last 24 hours.`,
      severity: 'medium',
      timestamp: now
    });

    recommendations.push({
      id: 'rec_audit_roles',
      title: 'Review recent permission audit logs',
      description: 'Multiple policy updates in a short window should be manually audited for authorization compliance.',
      targetUser: 'Admin'
    });
  }

  // 4. Detect Unusual Access Patterns (Late night logins)
  const nightLogins = await SecurityEvent.find({
    eventType: 'Login Success',
    createdAt: { $gte: twentyFourHoursAgo }
  }).populate('userId', 'name email');

  const irregularLogins = nightLogins.filter(event => {
    const hour = new Date(event.createdAt).getHours();
    return hour >= 23 || hour <= 4; // 11 PM to 4 AM
  });

  if (irregularLogins.length > 0) {
    alerts.push({
      id: 'unusual_login_hours',
      type: 'Irregular Access Pattern',
      title: 'Off-Hours Access Logins',
      description: `Detected ${irregularLogins.length} successful logins during off-hours (11 PM - 5 AM) in the last 24 hours.`,
      severity: 'low',
      timestamp: now
    });

    irregularLogins.slice(0, 3).forEach(event => {
      const userName = event.userId?.name || event.metadata?.email || 'Unknown User';
      recommendations.push({
        id: `rec_hours_${event._id}`,
        title: `Audit off-hours access for ${userName}`,
        description: `Verified login at ${new Date(event.createdAt).toLocaleTimeString()} from IP ${event.metadata?.ipAddress || 'unknown'}. Verify if this aligns with work shifts.`,
        targetUser: userName
      });
    });
  }

  // 5. Inactive Agents/Users (Compliance review)
  const inactiveUsers = await User.find({
    isActive: true,
    $or: [
      { lastLogin: { $lte: thirtyDaysAgo } },
      { lastLogin: null, createdAt: { $lte: thirtyDaysAgo } }
    ]
  });

  if (inactiveUsers.length > 0) {
    alerts.push({
      id: 'dormant_users_flag',
      type: 'Compliance Risk',
      title: 'Dormant User Access Accounts',
      description: `Identified ${inactiveUsers.length} active users who have not logged in for over 30 days.`,
      severity: 'medium',
      timestamp: now
    });

    inactiveUsers.slice(0, 5).forEach(user => {
      recommendations.push({
        id: `rec_dormant_${user._id}`,
        title: `Deactivate dormant account: ${user.name}`,
        description: `Account (${user.email}) has been inactive since ${user.lastLogin ? user.lastLogin.toLocaleDateString() : 'creation'}. Recommend suspension for security hygiene.`,
        targetUser: user.name
      });
    });
  }

  // Calculate Security Compliance Score (Starts at 100, drops per alert severity)
  let securityScore = 100;
  alerts.forEach(alert => {
    switch (alert.severity) {
      case 'critical':
        securityScore -= 15;
        break;
      case 'high':
        securityScore -= 10;
        break;
      case 'medium':
        securityScore -= 5;
        break;
      case 'low':
        securityScore -= 2;
        break;
    }
  });

  if (securityScore < 0) securityScore = 0;

  return {
    securityScore,
    alerts,
    recommendations
  };
};

module.exports = {
  runThreatAnalysis
};
