const mongoose = require('mongoose');

const UserDataSchema = new mongoose.Schema(
  {
    member_id: { type: String, required: true, unique: true },
    member_name: { type: String, required: true },
    date_of_birth: { type: Date },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    contact_info: {
      email: { type: String },
      phone: { type: String },
    },
    company_name: { type: String, required: true },
    join_date: { type: Date, required: true },
    member_type: {
      type: String,
      enum: ['Employee', 'Dependent'],
      default: 'Employee',
    },
    primary_member_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserData',
    },
    medical_history: {
      pre_existing_conditions: [{ type: String }],
      notes: { type: String },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserData', UserDataSchema);
