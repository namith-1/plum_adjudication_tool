const mongoose = require('mongoose');

const PolicyDataSchema = new mongoose.Schema(
  {
    policy_id: { type: String, required: true, unique: true },
    policy_name: { type: String, required: true },
    company_name: { type: String, required: true },
    effective_date: { type: Date, required: true },
    coverage_details: {
      annual_limit: { type: Number, required: true },
      per_claim_limit: { type: Number, required: true },
      family_floater_limit: { type: Number },
      consultation_fees: {
        covered: { type: Boolean, default: true },
        sub_limit: { type: Number },
        copay_percentage: { type: Number, default: 0 },
        network_discount: { type: Number, default: 0 },
      },
      diagnostic_tests: {
        covered: { type: Boolean, default: true },
        sub_limit: { type: Number },
        pre_authorization_required: { type: Boolean, default: false },
        covered_tests: [{ type: String }],
      },
      pharmacy: {
        covered: { type: Boolean, default: true },
        sub_limit: { type: Number },
        generic_drugs_mandatory: { type: Boolean, default: false },
        branded_drugs_copay: { type: Number, default: 0 },
      },
      dental: {
        covered: { type: Boolean, default: false },
        sub_limit: { type: Number },
        routine_checkup_limit: { type: Number },
        procedures_covered: [{ type: String }],
        cosmetic_procedures: { type: Boolean, default: false },
      },
      vision: {
        covered: { type: Boolean, default: false },
        sub_limit: { type: Number },
        eye_test_covered: { type: Boolean, default: false },
        glasses_contact_lenses: { type: Boolean, default: false },
        lasik_surgery: { type: Boolean, default: false },
      },
      alternative_medicine: {
        covered: { type: Boolean, default: false },
        sub_limit: { type: Number },
        covered_treatments: [{ type: String }],
        therapy_sessions_limit: { type: Number },
      },
    },
    waiting_periods: {
      initial_waiting_days: { type: Number, default: 30 },
      pre_existing_diseases_days: { type: Number, default: 365 },
      maternity_days: { type: Number },
      specific_ailments: { type: Map, of: Number },
    },
    exclusions: [{ type: String }],
    claim_requirements: {
      documents_required: [{ type: String }],
      submission_timeline_days: { type: Number, default: 30 },
      minimum_claim_amount: { type: Number, default: 0 },
    },
    network_hospitals: [{ type: String }],
    cashless_facilities: {
      available: { type: Boolean, default: false },
      network_only: { type: Boolean, default: true },
      pre_approval_required: { type: Boolean, default: false },
      instant_approval_limit: { type: Number },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PolicyData', PolicyDataSchema);
