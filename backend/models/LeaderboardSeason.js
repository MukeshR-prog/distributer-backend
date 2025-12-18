const mongoose = require('mongoose');

const leaderboardSeasonSchema = new mongoose.Schema({
  seasonName: {
    type: String,
    required: true,
    unique: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  topPerformers: [
    {
      agentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      rank: {
        type: Number,
        required: true
      },
      score: {
        type: Number,
        required: true
      }
    }
  ],
  rewards: [
    {
      rank: { type: Number, required: true },
      pointsReward: { type: Number, required: true }
    }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('LeaderboardSeason', leaderboardSeasonSchema);
