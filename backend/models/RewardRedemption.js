const mongoose = require('mongoose');

const rewardRedemptionSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rewardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RewardCatalog',
    required: true
  },
  redeemedAt: {
    type: Date,
    default: Date.now
  },
  pointsSpent: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('RewardRedemption', rewardRedemptionSchema);
