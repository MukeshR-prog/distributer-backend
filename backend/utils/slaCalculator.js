const memo = new Map();

/**
 * Calculates the SLA status for a record.
 * @param {Object} record - The record object containing dueDate and status.
 * @returns {String} The SLA status ('on_track', 'approaching_deadline', or 'overdue')
 */
const calculateSLA = (record) => {
  if (record.status === 'completed' || record.status === 'cancelled') {
    return 'on_track';
  }

  if (!record.dueDate) {
    return 'on_track';
  }

  // Coarsen current time to 1-minute intervals for cache efficiency
  const coarsenTime = Math.floor(Date.now() / 60000);
  const dueDateMs = new Date(record.dueDate).getTime();
  const cacheKey = `${record.status}_${dueDateMs}_${coarsenTime}`;

  if (memo.has(cacheKey)) {
    return memo.get(cacheKey);
  }

  const now = new Date();
  const dueDate = new Date(record.dueDate);
  const timeDiff = dueDate.getTime() - now.getTime();

  let slaStatus = 'on_track';

  if (timeDiff < 0) {
    slaStatus = 'overdue';
  } else if (timeDiff < 24 * 60 * 60 * 1000) { // Less than 24 hours
    slaStatus = 'approaching_deadline';
  }

  // Set to cache and return
  memo.set(cacheKey, slaStatus);

  // Clean old cache entries if map grows too large to prevent memory leaks
  if (memo.size > 5000) {
    // Keep only the most recent entries by clearing half the map
    const keys = Array.from(memo.keys());
    for (let i = 0; i < 2500; i++) {
      memo.delete(keys[i]);
    }
  }

  return slaStatus;
};

/**
 * Calculates the escalation level for a record if it is overdue.
 * @param {Object} record - The record object containing dueDate and status.
 * @returns {String|null} The escalation level ('LEVEL_1', 'LEVEL_2', 'LEVEL_3') or null
 */
const getEscalationLevel = (record) => {
  if (record.status === 'completed' || record.status === 'cancelled') {
    return null;
  }

  if (!record.dueDate) {
    return null;
  }

  const now = new Date();
  const dueDate = new Date(record.dueDate);
  const timeOverdue = now.getTime() - dueDate.getTime();

  if (timeOverdue <= 0) {
    return null;
  }

  const hours = timeOverdue / (1000 * 60 * 60);

  if (hours > 7 * 24) { // > 7 days
    return 'LEVEL_3';
  } else if (hours > 72) { // > 72 hours
    return 'LEVEL_2';
  } else if (hours > 24) { // > 24 hours
    return 'LEVEL_1';
  }

  return null;
};

module.exports = { calculateSLA, getEscalationLevel };
