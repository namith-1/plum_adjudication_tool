const mongoose = require('mongoose');

const DocumentExtractionSchema = new mongoose.Schema(
  {
    document_type: {
      type: String,
      enum: ['Prescription', 'Bill', 'Diagnostic_Report', 'Pharmacy_Bill'],
    },
    file_url: { type: String },
    file_name: { type: String },
    mime_type: { type: String },
    extracted_data: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const UserPolicyClaimsSchema = new mongoose.Schema(
  {
    claim_id: { type: String, required: true, unique: true },
    user_policy_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserPolicy',
      required: true,
    },
    treatment_date: { type: Date, required: true },
    submission_date: { type: Date },
    hospital_details: {
      name: { type: String, default: 'Unknown' },
      is_network_hospital: { type: Boolean, default: false },
    },
    cashless_request: { type: Boolean, default: false },
    financials: {
      claimed_amount: { type: Number, required: true },
      consultation_fee: { type: Number, default: 0 },
      diagnostic_tests_fee: { type: Number, default: 0 },
      medicines_fee: { type: Number, default: 0 },
    },
    documents: [DocumentExtractionSchema],
    adjudication: {
      decision: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'PARTIAL', 'REJECTED', 'MANUAL_REVIEW', 'REQUEST_CLEAR_IMAGE', 'REQUEST_MORE_INFO'],
        default: 'PENDING',
      },
      approved_amount: { type: Number, default: 0 },
      deductions: {
        copay_amount: { type: Number, default: 0 },
        network_discount: { type: Number, default: 0 },
      },
      rejection_reasons: [{ type: String }],
      confidence_score: { type: Number, min: 0, max: 1 },
      flags: [{ type: String }],
      notes: { type: String },
      raw_result: { type: mongoose.Schema.Types.Mixed },
    },
    duplicate_of_claim_id: { type: mongoose.Schema.Types.ObjectId, ref: 'UserPolicyClaims' },
  },
  { timestamps: true }
);

UserPolicyClaimsSchema.index({ user_policy_id: 1, treatment_date: 1 });

module.exports = mongoose.model('UserPolicyClaims', UserPolicyClaimsSchema);
