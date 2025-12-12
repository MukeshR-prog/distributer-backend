const Distribution = require('../models/Distribution');
const User = require('../models/User');
const Record = require('../models/Record');
const asyncHandler = require('express-async-handler');
const { buildFilters } = require('../utils/filterBuilder');
const { logActivity } = require('../utils/activityLogger');
const { logAudit } = require('../utils/auditLogger');
const { calculateSLA } = require('../utils/slaCalculator');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');

/**
 * @desc    Upload file and distribute among agents
 * @route   POST /api/distributions/upload
 * @access  Private (Admin)
 */
const uploadAndDistribute = asyncHandler(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileExtension = path.extname(fileName).toLowerCase();

    // Validate file type
    if (!['.csv', '.xlsx', '.xls'].includes(fileExtension)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only CSV, XLSX, and XLS files are allowed.'
      });
    }

    // Parse file data
    let records = [];
    
    if (fileExtension === '.csv') {
      records = await parseCSV(filePath);
    } else {
      records = await parseExcel(filePath);
    }

    // Validate records format
    if (!validateRecords(records)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file format. Required columns: FirstName, Phone, Notes'
      });
    }

    // Get all active agents
    const agents = await User.find({ role: 'agent', isActive: true });
    
    if (agents.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active agents found. Please ensure at least one agent is registered.'
      });
    }

    // Distribute records among agents
    const distributedRecords = distributeRecords(records, agents);

    // Create distribution document
const distribution = new Distribution({
  fileName,
  originalFileName: fileName,
  filePath,
  fileSize: req.file.size,
  uploadedBy: req.user._id,
  totalRecords: records.length,
  strategy: req.body.strategy || 'equal',
  agents: distributedRecords.map(agent => ({
    agentId: agent.agentId,
    agentName: agent.agentName,
    agentEmail: agent.agentEmail,
    assignedCount: agent.records.length,
    records: agent.records
  })),
  status: 'completed'
});

    await distribution.save();

    // Log activity
    await logActivity({
      actionType: 'DISTRIBUTION_UPLOADED',
      entityType: 'Distribution',
      entityId: distribution._id,
      userId: req.user._id,
      metadata: {
        distributionId: distribution._id,
        fileName: distribution.fileName,
        totalRecords: distribution.totalRecords,
        strategy: distribution.strategy
      }
    }, req.app.get('io'));

    // Log audit
    await logAudit({
      actionType: 'DISTRIBUTION_UPLOADED',
      entityType: 'Distribution',
      entityId: distribution._id,
      previousState: null,
      newState: distribution.toObject ? distribution.toObject() : distribution,
      userId: req.user._id,
      ipAddress: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent']
    });

    // Clean up uploaded file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({
      success: true,
      message: 'File uploaded and distributed successfully',
      data: {
        distributionId: distribution._id,
        totalRecords: records.length,
        agentsCount: agents.length,
        distributedRecords: distributedRecords.map(agent => ({
          agentName: agent.agentName,
          agentEmail: agent.agentEmail,
          recordsAssigned: agent.records.length
        }))
      }
    });

  } catch (error) {
    console.error('Error in uploadAndDistribute:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing file distribution',
      error: error.message
    });
  }
});

/**
 * @desc    Get all distributions
 * @route   GET /api/distributions
 * @access  Private
 */
const getDistributions = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = buildFilters(req.query, 'distribution');

    const distributions = await Distribution
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('uploadedBy', 'name email')
      .populate('agents.agentId', 'name email');

    const total = await Distribution.countDocuments(filter);

    res.json({
      success: true,
      data: {
        distributions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error in getDistributions:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @desc    Get single distribution
 * @route   GET /api/distributions/:id
 * @access  Private
 */
const getDistribution = asyncHandler(async (req, res) => {
  const distribution = await Distribution.findById(req.params.id)
    .populate('uploadedBy', 'name email')
    .populate('agents.agentId', 'name email');

  if (!distribution) {
    return res.status(404).json({
      success: false,
      message: 'Distribution not found'
    });
  }

  const distributionObj = distribution.toObject ? distribution.toObject() : JSON.parse(JSON.stringify(distribution));
  const { calculateSLA, getEscalationLevel } = require('../utils/slaCalculator');
  
  distributionObj.agents.forEach(agent => {
    agent.records.forEach(record => {
      record.slaStatus = calculateSLA(record);
      record.escalationLevel = getEscalationLevel(record);
    });
  });

  res.json({
    success: true,
    data: { distribution: distributionObj }
  });
});

/**
 * @desc    Get agent's records across all distributions
 * @route   GET /api/distributions/my-records
 * @access  Private (Agent)
 */
const getMyRecords = asyncHandler(async (req, res) => {
  try {
    // Find all distributions where this agent is assigned
    const distributions = await Distribution.find({
      'agents.agentId': req.user._id
    }).populate('uploadedBy', 'name email');

    // Collect all records assigned to this agent
    let allRecords = [];
    const { calculateSLA, getEscalationLevel } = require('../utils/slaCalculator');
    
    distributions.forEach(distribution => {
      const agentData = distribution.agents.find(
        agent => agent.agentId.toString() === req.user._id.toString()
      );
      
      if (agentData && agentData.records) {
        // Add distribution info to each record
        const recordsWithDistribution = agentData.records.map(record => {
          const recObj = record.toObject ? record.toObject() : JSON.parse(JSON.stringify(record));
          return {
            ...recObj,
            distributionId: distribution._id,
            distributionName: distribution.fileName,
            uploadedBy: distribution.uploadedBy,
            slaStatus: calculateSLA(record),
            escalationLevel: getEscalationLevel(record)
          };
        });
        
        allRecords = allRecords.concat(recordsWithDistribution);
      }
    });

    // Implement backend sorting priority
    allRecords.sort((a, b) => {
      const isActiveA = (a.status === 'pending' || a.status === 'in-progress') ? 1 : 0;
      const isActiveB = (b.status === 'pending' || b.status === 'in-progress') ? 1 : 0;
      if (isActiveA !== isActiveB) {
        return isActiveB - isActiveA; // active tasks first
      }

      const slaA = calculateSLA(a);
      const slaB = calculateSLA(b);

      const isCriticalOverdueA = (a.priority === 'critical' && slaA === 'overdue') ? 1 : 0;
      const isCriticalOverdueB = (b.priority === 'critical' && slaB === 'overdue') ? 1 : 0;

      // 1. Critical + Overdue
      if (isCriticalOverdueA !== isCriticalOverdueB) {
        return isCriticalOverdueB - isCriticalOverdueA;
      }

      // 2. Priority sorting
      const priorityWeights = { critical: 4, high: 3, medium: 2, low: 1 };
      const weightA = priorityWeights[a.priority?.toLowerCase()] || 0;
      const weightB = priorityWeights[b.priority?.toLowerCase()] || 0;

      if (weightA !== weightB) {
        return weightB - weightA;
      }

      // 3. Secondary sort: Nearest Due Date
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate) - new Date(b.dueDate);
      }
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;

      return 0;
    });

    // Calculate SLA stats
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const overdueCount = allRecords.filter(r => {
      const currentSla = calculateSLA(r);
      return r.status !== 'completed' && r.status !== 'cancelled' && currentSla === 'overdue';
    }).length;

    const approachingDeadlineCount = allRecords.filter(r => {
      const currentSla = calculateSLA(r);
      return r.status !== 'completed' && r.status !== 'cancelled' && currentSla === 'approaching_deadline';
    }).length;

    const completedToday = allRecords.filter(r => {
      return r.status === 'completed' && r.completedAt && new Date(r.completedAt) >= startOfToday;
    }).length;

    const criticalTasks = allRecords.filter(r => {
      return r.status !== 'completed' && r.status !== 'cancelled' && r.priority === 'critical';
    }).length;

    const completedCount = allRecords.filter(r => r.status === 'completed').length;
    const averageCompletionRate = allRecords.length > 0 ? Math.round((completedCount / allRecords.length) * 100) : 0;

    const onTrackTasks = allRecords.filter(r => {
      return r.status === 'completed' || calculateSLA(r) !== 'overdue';
    }).length;
    const slaCompliance = allRecords.length > 0 ? Math.round((onTrackTasks / allRecords.length) * 100) : 100;

    res.json({
      success: true,
      records: allRecords,
      summary: {
        total: allRecords.length,
        pending: allRecords.filter(r => r.status === 'pending').length,
        inProgress: allRecords.filter(r => r.status === 'in-progress').length,
        completed: allRecords.filter(r => r.status === 'completed').length,
        failed: allRecords.filter(r => r.status === 'failed').length,
        totalTasks: allRecords.length,
        completedTasks: allRecords.filter(r => r.status === 'completed').length,
        pendingTasks: allRecords.filter(r => r.status === 'pending').length,
        overdueTasks: overdueCount,
        criticalTasks: criticalTasks,
        slaStats: {
          overdueCount,
          approachingDeadlineCount,
          completedToday,
          criticalTasks,
          averageCompletionRate,
          slaCompliance
        }
      }
    });
  } catch (error) {
    console.error('Error in getMyRecords:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @desc    Update record status
 * @route   PUT /api/distributions/:id/records/:recordIndex
 * @access  Private (Agent)
 */
const updateRecordStatus = asyncHandler(async (req, res) => {
  const { status, notes } = req.body;
  const { id: distributionId, recordIndex } = req.params;

  const distribution = await Distribution.findById(distributionId);

  if (!distribution) {
    return res.status(404).json({
      success: false,
      message: 'Distribution not found'
    });
  }

  // Find agent's data
  const agentData = distribution.agents.find(
    agent => agent.agentId.toString() === req.user._id.toString()
  );

  if (!agentData) {
    return res.status(403).json({
      success: false,
      message: 'You are not assigned to this distribution'
    });
  }

  const previousState = distribution.toObject ? distribution.toObject() : JSON.parse(JSON.stringify(distribution));

  // Update record
  const recordIdx = parseInt(recordIndex);
  if (recordIdx >= 0 && recordIdx < agentData.records.length) {
    agentData.records[recordIdx].status = status;
    if (notes) agentData.records[recordIdx].notes = notes;
    // Explicitly recalculate SLA
    agentData.records[recordIdx].slaStatus = calculateSLA(agentData.records[recordIdx]);
    agentData.records[recordIdx].updatedAt = new Date();

    await distribution.save();

    // Log activity
    await logActivity({
      actionType: 'STATUS_UPDATED',
      entityType: 'Distribution',
      entityId: distribution._id,
      userId: req.user._id,
      metadata: {
        distributionId: distribution._id,
        recordId: agentData.records[recordIdx]._id,
        firstName: agentData.records[recordIdx].firstName,
        phone: agentData.records[recordIdx].phone,
        status: agentData.records[recordIdx].status,
        agentName: req.user.name
      }
    }, req.app.get('io'));

    // Log audit
    await logAudit({
      actionType: 'STATUS_UPDATED',
      entityType: 'Distribution',
      entityId: distribution._id,
      previousState,
      newState: distribution.toObject ? distribution.toObject() : distribution,
      userId: req.user._id,
      ipAddress: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      message: 'Record status updated successfully'
    });
  } else {
    res.status(400).json({
      success: false,
      message: 'Invalid record index'
    });
  }
});

/**
 * @desc    Get distribution statistics
 * @route   GET /api/distributions/stats
 * @access  Private (Admin)
 */
const getDistributionStats = asyncHandler(async (req, res) => {
  const stats = await Distribution.aggregate([
    {
      $group: {
        _id: null,
        totalDistributions: { $sum: 1 },
        totalRecords: { $sum: '$totalRecords' },
        avgRecordsPerDistribution: { $avg: '$totalRecords' }
      }
    }
  ]);

  res.json({
    success: true,
    data: stats[0] || {
      totalDistributions: 0,
      totalRecords: 0,
      avgRecordsPerDistribution: 0
    }
  });
});

/**
 * @desc    Export distribution
 * @route   GET /api/distributions/:id/export
 * @access  Private
 */
const exportDistribution = asyncHandler(async (req, res) => {
  const distribution = await Distribution.findById(req.params.id);

  if (!distribution) {
    return res.status(404).json({
      success: false,
      message: 'Distribution not found'
    });
  }

  res.json({
    success: true,
    data: distribution
  });
});

/**
 * @desc    Delete distribution
 * @route   DELETE /api/distributions/:id
 * @access  Private (Admin)
 */
const deleteDistribution = asyncHandler(async (req, res) => {
  const distribution = await Distribution.findById(req.params.id);

  if (!distribution) {
    return res.status(404).json({
      success: false,
      message: 'Distribution not found'
    });
  }

  await Distribution.findByIdAndDelete(req.params.id);

  res.json({
    success: true,
    message: 'Distribution deleted successfully'
  });
});

// Helper functions
const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const records = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => records.push(data))
      .on('end', () => resolve(records))
      .on('error', reject);
  });
};

const parseExcel = (filePath) => {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const records = XLSX.utils.sheet_to_json(worksheet);
    return Promise.resolve(records);
  } catch (error) {
    return Promise.reject(error);
  }
};

const validateRecords = (records) => {
  if (!records || records.length === 0) return false;
  
  const requiredFields = ['FirstName', 'Phone', 'Notes'];
  const firstRecord = records[0];
  
  return requiredFields.every(field => field in firstRecord);
};

const distributeRecords = (records, agents) => {
  const recordsPerAgent = Math.floor(records.length / agents.length);
  const remainder = records.length % agents.length;
  
  const distributedRecords = [];
  let recordIndex = 0;
  
  agents.forEach((agent, index) => {
    const recordsCount = recordsPerAgent + (index < remainder ? 1 : 0);
    const agentRecords = records.slice(recordIndex, recordIndex + recordsCount);
    
    distributedRecords.push({
      agentId: agent._id,
      agentName: agent.name,
      agentEmail: agent.email,
      records: agentRecords.map(record => {
        const priority = (record.Priority || record.priority || 'medium').toLowerCase();
        const rawDueDate = record.DueDate || record.dueDate || null;
        const dueDate = rawDueDate ? new Date(rawDueDate) : null;
        const slaStatus = calculateSLA({ status: 'pending', dueDate });
        
        return {
          firstName: record.FirstName,
          phone: record.Phone,
          notes: record.Notes,
          status: 'pending',
          priority: ['low', 'medium', 'high', 'critical'].includes(priority) ? priority : 'medium',
          dueDate,
          slaStatus,
          assignedAt: new Date(),
          updatedAt: new Date()
        };
      })
    });
    
    recordIndex += recordsCount;
  });
  
  return distributedRecords;
};

module.exports = {
  uploadAndDistribute,
  getDistributions,
  getDistribution,
  getMyRecords,
  updateRecordStatus,
  getDistributionStats,
  exportDistribution,
  deleteDistribution,
  updateRecordDetailsAdmin: asyncHandler(async (req, res) => {
    const { priority, dueDate } = req.body;
    const { id: distributionId, recordId } = req.params;

    const distribution = await Distribution.findById(distributionId);

    if (!distribution) {
      return res.status(404).json({
        success: false,
        message: 'Distribution not found'
      });
    }

    // Find record in the distribution
    let recordToUpdate = null;
    let targetAgent = null;

    for (const agent of distribution.agents) {
      const match = agent.records.find(r => r._id.toString() === recordId.toString());
      if (match) {
        recordToUpdate = match;
        targetAgent = agent;
        break;
      }
    }

    if (!recordToUpdate) {
      return res.status(404).json({
        success: false,
        message: 'Record not found in this distribution'
      });
    }

    const previousState = distribution.toObject ? distribution.toObject() : JSON.parse(JSON.stringify(distribution));

    let priorityChanged = false;
    let dueDateChanged = false;
    const oldPriority = recordToUpdate.priority;
    const oldDueDate = recordToUpdate.dueDate;

    if (priority && priority !== recordToUpdate.priority) {
      if (['low', 'medium', 'high', 'critical'].includes(priority.toLowerCase())) {
        recordToUpdate.priority = priority.toLowerCase();
        priorityChanged = true;
      }
    }

    if (dueDate !== undefined) {
      const newDueDate = dueDate ? new Date(dueDate) : null;
      const oldTime = oldDueDate ? new Date(oldDueDate).getTime() : null;
      const newTime = newDueDate ? newDueDate.getTime() : null;
      
      if (oldTime !== newTime) {
        recordToUpdate.dueDate = newDueDate;
        dueDateChanged = true;
      }
    }

    if (priorityChanged || dueDateChanged) {
      recordToUpdate.updatedAt = new Date();
      // Recalculate SLA
      recordToUpdate.slaStatus = calculateSLA(recordToUpdate);

      await distribution.save();

      // Log Activity for Priority Change
      if (priorityChanged) {
        await logActivity({
          actionType: 'PRIORITY_CHANGED',
          entityType: 'Distribution',
          entityId: distribution._id,
          userId: req.user._id,
          metadata: {
            distributionId: distribution._id,
            recordId: recordToUpdate._id,
            firstName: recordToUpdate.firstName,
            phone: recordToUpdate.phone,
            oldPriority,
            newPriority: recordToUpdate.priority,
            agentName: targetAgent.agentName
          }
        }, req.app.get('io'));
      }

      // Log Activity for Due Date Change
      if (dueDateChanged) {
        await logActivity({
          actionType: 'DUE_DATE_CHANGED',
          entityType: 'Distribution',
          entityId: distribution._id,
          userId: req.user._id,
          metadata: {
            distributionId: distribution._id,
            recordId: recordToUpdate._id,
            firstName: recordToUpdate.firstName,
            phone: recordToUpdate.phone,
            oldDueDate,
            newDueDate: recordToUpdate.dueDate,
            agentName: targetAgent.agentName
          }
        }, req.app.get('io'));
      }

      // Log Audit
      await logAudit({
        actionType: 'RECORD_UPDATED',
        entityType: 'Distribution',
        entityId: distribution._id,
        previousState,
        newState: distribution.toObject ? distribution.toObject() : distribution,
        userId: req.user._id,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent']
      });

      return res.json({
        success: true,
        message: 'Record updated successfully',
        record: recordToUpdate
      });
    }

    return res.json({
      success: true,
      message: 'No changes detected',
      record: recordToUpdate
    });
  }),
  
  reassignRecords: asyncHandler(async (req, res) => {
    const { id: distributionId } = req.params;
    const { recordIds, sourceAgentId, targetAgentId } = req.body;

    if (!recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Record IDs list must be a non-empty array'
      });
    }

    if (!sourceAgentId || !targetAgentId) {
      return res.status(400).json({
        success: false,
        message: 'Both sourceAgentId and targetAgentId are required'
      });
    }

    if (sourceAgentId.toString() === targetAgentId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Source agent and target agent cannot be the same'
      });
    }

    const distribution = await Distribution.findById(distributionId);

    if (!distribution) {
      return res.status(404).json({
        success: false,
        message: 'Distribution not found'
      });
    }

    const previousState = distribution.toObject ? distribution.toObject() : JSON.parse(JSON.stringify(distribution));

    const sourceAgent = distribution.agents.find(
      a => (a.agentId?._id || a.agentId || '').toString() === sourceAgentId.toString()
    );

    if (!sourceAgent) {
      return res.status(404).json({
        success: false,
        message: 'Source agent not assigned to this distribution'
      });
    }

    let targetAgent = distribution.agents.find(
      a => (a.agentId?._id || a.agentId || '').toString() === targetAgentId.toString()
    );

    // If target agent is not in the distribution list, retrieve user and add them
    if (!targetAgent) {
      const targetUser = await User.findById(targetAgentId);
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'Target agent user not found'
        });
      }
      distribution.agents.push({
        agentId: targetUser._id,
        agentName: targetUser.name,
        agentEmail: targetUser.email,
        assignedCount: 0,
        records: []
      });
      targetAgent = distribution.agents[distribution.agents.length - 1];
    }

    // Filter out records to move
    const recordsToMove = [];
    const remainingRecords = [];

    sourceAgent.records.forEach(record => {
      if (recordIds.includes(record._id.toString())) {
        recordsToMove.push(record);
      } else {
        remainingRecords.push(record);
      }
    });

    if (recordsToMove.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matching records found for source agent'
      });
    }

    // Perform reassignment
    sourceAgent.records = remainingRecords;
    sourceAgent.assignedCount = remainingRecords.length;

    targetAgent.records.push(...recordsToMove);
    targetAgent.assignedCount = targetAgent.records.length;

    await distribution.save();

    // Log Activities
    await logActivity({
      actionType: 'TASK_REASSIGNED',
      entityType: 'Distribution',
      entityId: distribution._id,
      userId: req.user._id,
      metadata: {
        distributionId: distribution._id,
        recordCount: recordsToMove.length,
        sourceAgentId,
        sourceAgentName: sourceAgent.agentName,
        targetAgentId,
        targetAgentName: targetAgent.agentName,
        recordIds
      }
    }, req.app.get('io'));

    await logActivity({
      actionType: 'WORKLOAD_BALANCED',
      entityType: 'Distribution',
      entityId: distribution._id,
      userId: req.user._id,
      metadata: {
        distributionId: distribution._id,
        reassignedCount: recordsToMove.length,
        sourceAgentName: sourceAgent.agentName,
        targetAgentName: targetAgent.agentName
      }
    }, req.app.get('io'));

    // Log Audit
    await logAudit({
      actionType: 'TASK_REASSIGNED',
      entityType: 'Distribution',
      entityId: distribution._id,
      previousState: {
        distribution: previousState,
        owner: {
          agentId: sourceAgentId,
          agentName: sourceAgent.agentName
        }
      },
      newState: {
        distribution: distribution.toObject ? distribution.toObject() : distribution,
        owner: {
          agentId: targetAgentId,
          agentName: targetAgent.agentName
        }
      },
      userId: req.user._id,
      ipAddress: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      message: `${recordsToMove.length} records successfully reassigned`,
      data: {
        distribution
      }
    });
  })
};