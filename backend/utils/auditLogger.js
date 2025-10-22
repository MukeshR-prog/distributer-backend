const AuditLog = require('../models/AuditLog');

/**
 * Creates and saves an audit log entry in the database.
 * @param {Object} params - Audit log details
 * @param {String} params.actionType - Action type string (e.g., AGENT_CREATED, STATUS_UPDATED)
 * @param {String} params.entityType - Targeted collection name (User, Distribution, Report, Record)
 * @param {String} params.entityId - Primary ID of targeted entity
 * @param {Object} [params.previousState] - Document data prior to action
 * @param {Object} [params.newState] - Document data after action
 * @param {String} params.userId - Performing user object ID
 * @param {String} [params.ipAddress] - Network origin client IP
 * @param {String} [params.userAgent] - Browser details of client
 * @returns {Promise<Object>} Created AuditLog Mongoose document
 */
const logAudit = async ({
  actionType,
  entityType,
  entityId,
  previousState = null,
  newState = null,
  userId,
  ipAddress = 'Unknown',
  userAgent = 'Unknown'
}) => {
  try {
    const audit = await AuditLog.create({
      actionType,
      entityType,
      entityId,
      performedBy: userId,
      previousState,
      newState,
      ipAddress: ipAddress || 'Unknown',
      userAgent: userAgent || 'Unknown'
    });
    return audit;
  } catch (error) {
    console.error('⚠️  Failed to create audit log:', error.message);
    // Gracefully return null without throwing to avoid interfering with API responses
    return null;
  }
};

module.exports = {
  logAudit
};
