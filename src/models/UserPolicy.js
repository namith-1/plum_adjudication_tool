const mongoose = require('mongoose');

const UserPolicySchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserData',
      required: true,
    },
    policy_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PolicyData',
      required: true,
    },
    enrollment_date: { type: Date, required: true },
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Expired'],
      default: 'Active',
    },
    utilization: {
      total_claimed_amount_ytd: { type: Number, default: 0 },
      consultation_utilized: { type: Number, default: 0 },
      diagnostic_utilized: { type: Number, default: 0 },
      pharmacy_utilized: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

UserPolicySchema.index({ user_id: 1, policy_id: 1 }, { unique: true });

module.exports = mongoose.model('UserPolicy', UserPolicySchema);
