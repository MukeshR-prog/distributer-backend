const mongoose = require('mongoose');

const distributionSchema = new mongoose.Schema({
  fileName: {
    type: String,
    required: [true, 'File name is required'],
    trim: true
  },
  originalFileName: {
    type: String,
    required: [true, 'Original file name is required']
  },
  fileSize: {
    type: Number,
    required: [true, 'File size is required']
  },
  totalRecords: {
    type: Number,
    required: [true, 'Total records count is required'],
    min: [1, 'Must have at least 1 record']
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  distributionStrategy: {
    type: String,
    enum: ['equal', 'weighted', 'priority'],
    default: 'equal'
  },
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed'],
    default: 'processing'
  },
  agents: [{
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    agentName: {
      type: String,
      required: true
    },
    agentEmail: {
      type: String,
      required: true
    },
    assignedCount: {
      type: Number,
      required: true,
      min: 0
    },
    records: [{
      firstName: {
        type: String,
        required: true,
        trim: true
      },
      phone: {
        type: String,
        required: true,
        validate: {
          validator: function(v) {
            return /^\+?\d{10,15}$/.test(v);
          },
          message: 'Please enter a valid phone number'
        }
      },
      notes: {
        type: String,
        trim: true,
        maxlength: [500, 'Notes cannot exceed 500 characters']
      },
      status: {
        type: String,
        enum: ['pending', 'in-progress', 'completed', 'failed'],
        default: 'pending'
      },
      priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
      },
      dueDate: {
        type: Date,
        default: null
      },
      slaStatus: {
        type: String,
        enum: ['on_track', 'approaching_deadline', 'overdue'],
        default: 'on_track'
      },
      assignedAt: {
        type: Date,
        default: Date.now
      },
      completedAt: {
        type: Date
      }
    }]
  }],
  summary: {
    totalAgentsAssigned: {
      type: Number,
      default: 0
    },
    averageRecordsPerAgent: {
      type: Number,
      default: 0
    },
    distributionTime: {
      type: Number, // in milliseconds
      default: 0
    }
  },
  metadata: {
    columns: [{
      name: String,
      type: String,
      required: Boolean
    }],
    validationErrors: [{
      row: Number,
      column: String,
      error: String,
      value: String
    }],
    skippedRows: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for completion percentage
distributionSchema.virtual('completionPercentage').get(function() {
  if (this.totalRecords === 0) return 0;
  
  let completedRecords = 0;
  this.agents.forEach(agent => {
    completedRecords += agent.records.filter(record => record.status === 'completed').length;
  });
  
  return Math.round((completedRecords / this.totalRecords) * 100);
});

// Virtual for pending records count
distributionSchema.virtual('pendingRecords').get(function() {
  let pendingCount = 0;
  this.agents.forEach(agent => {
    pendingCount += agent.records.filter(record => record.status === 'pending').length;
  });
  return pendingCount;
});

// Virtual for in-progress records count
distributionSchema.virtual('inProgressRecords').get(function() {
  let inProgressCount = 0;
  this.agents.forEach(agent => {
    inProgressCount += agent.records.filter(record => record.status === 'in-progress').length;
  });
  return inProgressCount;
});

// Pre-save middleware to calculate summary
distributionSchema.pre('save', function(next) {
  if (this.agents && this.agents.length > 0) {
    this.summary.totalAgentsAssigned = this.agents.length;
    this.summary.averageRecordsPerAgent = Math.round(this.totalRecords / this.agents.length);

    // Recalculate SLA statuses
    const { calculateSLA } = require('../utils/slaCalculator');
    this.agents.forEach(agent => {
      agent.records.forEach(record => {
        record.slaStatus = calculateSLA(record);
      });
    });
  }
  next();
});

// Static method to get distribution statistics
distributionSchema.statics.getDistributionStats = async function() {
  try {
    const stats = await this.aggregate([
      {
        $group: {
          _id: null,
          totalDistributions: { $sum: 1 },
          totalRecordsProcessed: { $sum: '$totalRecords' },
          completedDistributions: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          failedDistributions: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          avgRecordsPerDistribution: { $avg: '$totalRecords' },
          avgDistributionTime: { $avg: '$summary.distributionTime' }
        }
      }
    ]);
    
    return stats[0] || {
      totalDistributions: 0,
      totalRecordsProcessed: 0,
      completedDistributions: 0,
      failedDistributions: 0,
      avgRecordsPerDistribution: 0,
      avgDistributionTime: 0
    };
  } catch (error) {
    throw error;
  }
};

// Method to update record status
distributionSchema.methods.updateRecordStatus = function(agentId, recordIndex, status) {
  const agent = this.agents.find(a => a.agentId.toString() === agentId.toString());
  if (agent && agent.records[recordIndex]) {
    agent.records[recordIndex].status = status;
    if (status === 'completed') {
      agent.records[recordIndex].completedAt = new Date();
    }
    return this.save();
  }
  throw new Error('Record not found');
};

// Method to get agent performance
distributionSchema.methods.getAgentPerformance = function() {
  return this.agents.map(agent => {
    const total = agent.records.length;
    const completed = agent.records.filter(r => r.status === 'completed').length;
    const inProgress = agent.records.filter(r => r.status === 'in-progress').length;
    const pending = agent.records.filter(r => r.status === 'pending').length;
    
    return {
      agentId: agent.agentId,
      agentName: agent.agentName,
      agentEmail: agent.agentEmail,
      totalAssigned: total,
      completed,
      inProgress,
      pending,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0
    };
  });
};
// Indexes for optimized filter performance
distributionSchema.index({ status: 1 });
distributionSchema.index({ 'agents.agentId': 1 });
distributionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Distribution', distributionSchema);
