const ActivityLog = require('../models/ActivityLog');

/**
 * Creates and saves an activity log, broadcasting live updates if WebSocket instance is provided.
 * @param {Object} params - Activity log details
 * @param {String} params.actionType - AGENT_CREATED | AGENT_DELETED | DISTRIBUTION_UPLOADED | REPORT_GENERATED | STATUS_UPDATED
 * @param {String} params.entityType - User | Distribution | Report | Record
 * @param {String} params.entityId - ID of targeted entity
 * @param {String} params.userId - User ID performing the action
 * @param {Object} [params.metadata] - Additional detail snapshots
 * @param {Object} [io] - Express Socket.IO instance to emit events live
 * @returns {Promise<Object>} Created ActivityLog document
 */
const logActivity = async ({ actionType, entityType, entityId, userId, metadata }, io = null) => {
  try {
    const activity = await ActivityLog.create({
      actionType,
      entityType,
      entityId,
      performedBy: userId,
      metadata
    });

    // Populate performedBy details for socket/live preview display
    const populated = await ActivityLog.findById(activity._id).populate('performedBy', 'name email role');

    // Broadcast update via socket if present
    if (io) {
      console.log(`📡 Emitting live activity socket update for: ${actionType}`);
      io.emit('newUpdatedActivity', populated);
    }

    return populated;
  } catch (error) {
    console.error('⚠️  Failed to create activity log:', error.message);
    // Return null instead of throwing to prevent blocking the core business action
    return null;
  }
};

module.exports = {
  logActivity
};
