const mongoose = require('mongoose');

const rewardCatalogSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    required: true
  },
  costPoints: {
    type: Number,
    required: true
  },
  itemType: {
    type: String,
    enum: ['badge', 'title', 'theme'],
    required: true
  },
  badgeIcon: {
    type: String,
    default: ''
  },
  themeColor: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('RewardCatalog', rewardCatalogSchema);
