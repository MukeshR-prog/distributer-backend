const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please enter a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  rawPassword: {
    type: String,
    select: false
  },
  countryCode: {
    type: String,
    required: function() {
      return this.role === 'agent';
    },
    validate: {
      validator: function(v) {
        if (this.role === 'agent' && v) {
          return /^\+\d{1,3}$/.test(v);
        }
        return true;
      },
      message: 'Please enter a valid country code (e.g., +1, +91)'
    }
  },
  phone: {
    type: String,
    required: function() {
      return this.role === 'agent';
    },
    validate: {
      validator: function(v) {
        if (this.role === 'agent' && v) {
          return /^\d{10}$/.test(v);
        }
        return true;
      },
      message: 'Please enter a valid 10-digit phone number'
    }
  },
  role: {
    type: String,
    enum: ['admin', 'agent'],
    default: 'agent'
  },
  roleTemplate: {
    type: String,
    default: 'agent'
  },
  department: {
    type: String,
    default: 'General Operations'
  },
  team: {
    type: String,
    default: 'Default Team'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  loginCount: {
    type: Number,
    default: 0
  },
  assignedTasks: {
    type: Number,
    default: 0
  },
  completedTasks: {
    type: Number,
    default: 0
  },
  profileImage: {
    type: String,
    default: null
  },
  points: {
    type: Number,
    default: 0
  },
  xp: {
    type: Number,
    default: 0
  },
  level: {
    type: Number,
    default: 1
  },
  currentStreak: {
    type: Number,
    default: 0
  },
  longestStreak: {
    type: Number,
    default: 0
  },
  unlockedTitles: {
    type: [String],
    default: []
  },
  unlockedThemes: {
    type: [String],
    default: []
  },
  selectedTitle: {
    type: String,
    default: ""
  },
  selectedTheme: {
    type: String,
    default: ""
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for mobile number (combining country code and phone)
userSchema.virtual('mobile').get(function() {
  if (this.countryCode && this.phone) {
    return this.countryCode + this.phone;
  }
  return null;
});

// Virtual for completion rate
userSchema.virtual('completionRate').get(function() {
  if (this.assignedTasks === 0) return 0;
  return Math.round((this.completedTasks / this.assignedTasks) * 100);
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    // Store raw password before hashing
    this.rawPassword = this.password;
    
    // Hash the password
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Update last login
userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  this.loginCount += 1;
  return this.save({ validateBeforeSave: false });
};

// Static method to get agent statistics
userSchema.statics.getAgentStats = async function() {
  try {
    const stats = await this.aggregate([
      { $match: { role: 'agent' } },
      {
        $group: {
          _id: null,
          totalAgents: { $sum: 1 },
          activeAgents: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          totalAssignedTasks: { $sum: '$assignedTasks' },
          totalCompletedTasks: { $sum: '$completedTasks' }
        }
      }
    ]);
    
    return stats[0] || {
      totalAgents: 0,
      activeAgents: 0,
      totalAssignedTasks: 0,
      totalCompletedTasks: 0
    };
  } catch (error) {
    throw error;
  }
};

// Indexes for optimized filter performance
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ name: 1 });
userSchema.index({ phone: 1 });

module.exports = mongoose.model('User', userSchema);