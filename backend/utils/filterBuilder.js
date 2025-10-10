const mongoose = require('mongoose');

/**
 * Generates MongoDB filter objects from HTTP query parameters.
 * @param {Object} queryParams - The request query parameters (req.query)
 * @param {String} type - The model type ('agent' or 'distribution')
 * @returns {Object} MongoDB query filter object
 */
const buildFilters = (queryParams, type) => {
  const filter = {};

  if (type === 'agent') {
    // We only query user accounts with the 'agent' role
    filter.role = 'agent';

    // Status Filter (active vs inactive)
    if (queryParams.status) {
      if (queryParams.status === 'active' || queryParams.status === 'true') {
        filter.isActive = true;
      } else if (queryParams.status === 'inactive' || queryParams.status === 'false') {
        filter.isActive = false;
      }
    }

    // Search Term
    if (queryParams.search) {
      const searchRegex = { $regex: queryParams.search, $options: 'i' };
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ];
    }
  } else if (type === 'distribution') {
    // Status Filter (processing, completed, failed)
    if (queryParams.status && queryParams.status !== 'all') {
      filter.status = queryParams.status;
    }

    // Agent Filter (Distribution assigned to a specific agent)
    if (queryParams.agentId && queryParams.agentId !== 'all' && queryParams.agentId !== '') {
      if (mongoose.Types.ObjectId.isValid(queryParams.agentId)) {
        filter['agents.agentId'] = new mongoose.Types.ObjectId(queryParams.agentId);
      }
    }

    // Date Range Filter (from/to or startDate/endDate)
    const fromDate = queryParams.from || queryParams.startDate;
    const toDate = queryParams.to || queryParams.endDate;

    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) {
        filter.createdAt.$gte = new Date(fromDate);
      }
      if (toDate) {
        const end = new Date(toDate);
        // If it's a date only without time (e.g. "2025-10-10"), set to end of that day
        if (toDate.length <= 10) {
          end.setHours(23, 59, 59, 999);
        }
        filter.createdAt.$lte = end;
      }
    }

    // Search Term
    if (queryParams.search) {
      const searchRegex = { $regex: queryParams.search, $options: 'i' };
      filter.$or = [
        { fileName: searchRegex },
        { 'agents.agentName': searchRegex },
        { 'agents.agentEmail': searchRegex }
      ];
    }
  }

  return filter;
};

module.exports = { buildFilters };
