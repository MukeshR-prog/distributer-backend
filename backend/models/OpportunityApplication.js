const mongoose = require('mongoose');

const opportunityApplicationSchema = new mongoose.Schema({
  opportunityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Opportunity',
    required: [true, 'Opportunity ID is required']
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Agent User ID is required'],
    index: true
  },
  status: {
    type: String,
    enum: ['APPLIED', 'REVIEWING', 'ACCEPTED', 'REJECTED'],
    default: 'APPLIED',
    index: true
  },
  appliedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Ensure a single agent can only apply once per opportunity
opportunityApplicationSchema.index({ opportunityId: 1, agentId: 1 }, { unique: true });

module.exports = mongoose.model('OpportunityApplication', opportunityApplicationSchema);
