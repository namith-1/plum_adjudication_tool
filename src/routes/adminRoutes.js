const express = require('express');
const { PolicyData, UserData, UserPolicy } = require('../models');

const router = express.Router();

function required(value, name) {
  if (value === undefined || value === null || value === '') {
    const error = new Error(`${name} is required`);
    error.statusCode = 400;
    throw error;
  }
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

router.get('/users', async (req, res, next) => {
  try {
    const users = await UserData.find({})
      .populate('primary_member_id', 'member_id member_name')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ users });
  } catch (error) {
    next(error);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    required(req.body.member_id, 'member_id');
    required(req.body.member_name, 'member_name');
    required(req.body.company_name, 'company_name');
    required(req.body.join_date, 'join_date');

    const memberType = req.body.member_type === 'Dependent' ? 'Dependent' : 'Employee';
    let primaryMember = null;

    if (memberType === 'Dependent') {
      required(req.body.primary_member_id, 'primary_member_id');
      primaryMember = await UserData.findOne({ member_id: req.body.primary_member_id });

      if (!primaryMember) {
        const error = new Error(`Primary employee ${req.body.primary_member_id} was not found`);
        error.statusCode = 404;
        throw error;
      }
    }

    const user = await UserData.findOneAndUpdate(
      { member_id: req.body.member_id },
      {
        member_id: req.body.member_id,
        member_name: req.body.member_name,
        date_of_birth: req.body.date_of_birth || undefined,
        gender: req.body.gender || undefined,
        company_name: req.body.company_name,
        join_date: req.body.join_date,
        member_type: memberType,
        primary_member_id: primaryMember?._id || undefined,
        contact_info: {
          email: req.body.email || undefined,
          phone: req.body.phone || undefined,
        },
        medical_history: {
          pre_existing_conditions: toArray(req.body.pre_existing_conditions),
          notes: req.body.medical_notes || undefined,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(201).json({ saved: true, user });
  } catch (error) {
    next(error);
  }
});

router.get('/policies', async (req, res, next) => {
  try {
    const policies = await PolicyData.find({}).sort({ createdAt: -1 }).limit(100).lean();

    res.json({ policies });
  } catch (error) {
    next(error);
  }
});

router.post('/policies', async (req, res, next) => {
  try {
    required(req.body.policy_id, 'policy_id');
    required(req.body.policy_name, 'policy_name');
    required(req.body.company_name, 'company_name');
    required(req.body.effective_date, 'effective_date');

    const policy = await PolicyData.findOneAndUpdate(
      { policy_id: req.body.policy_id },
      {
        policy_id: req.body.policy_id,
        policy_name: req.body.policy_name,
        company_name: req.body.company_name,
        effective_date: req.body.effective_date,
        coverage_details: {
          annual_limit: toNumber(req.body.annual_limit, 50000),
          per_claim_limit: toNumber(req.body.per_claim_limit, 5000),
          family_floater_limit: toNumber(req.body.family_floater_limit),
          consultation_fees: {
            covered: req.body.consultation_covered !== false,
            sub_limit: toNumber(req.body.consultation_sub_limit, 2000),
            copay_percentage: toNumber(req.body.consultation_copay_percentage),
            network_discount: toNumber(req.body.network_discount),
          },
          diagnostic_tests: {
            covered: req.body.diagnostic_covered !== false,
            sub_limit: toNumber(req.body.diagnostic_sub_limit, 10000),
            pre_authorization_required: req.body.diagnostic_pre_auth === true,
            covered_tests: toArray(req.body.covered_tests),
          },
          pharmacy: {
            covered: req.body.pharmacy_covered !== false,
            sub_limit: toNumber(req.body.pharmacy_sub_limit, 15000),
            generic_drugs_mandatory: req.body.generic_drugs_mandatory === true,
            branded_drugs_copay: toNumber(req.body.branded_drugs_copay),
          },
          dental: {
            covered: req.body.dental_covered === true,
            sub_limit: toNumber(req.body.dental_sub_limit),
            procedures_covered: toArray(req.body.dental_procedures),
            cosmetic_procedures: req.body.cosmetic_procedures === true,
          },
          vision: {
            covered: req.body.vision_covered === true,
            sub_limit: toNumber(req.body.vision_sub_limit),
            eye_test_covered: req.body.eye_test_covered === true,
            glasses_contact_lenses: req.body.glasses_contact_lenses === true,
          },
          alternative_medicine: {
            covered: req.body.alternative_covered === true,
            sub_limit: toNumber(req.body.alternative_sub_limit),
            covered_treatments: toArray(req.body.alternative_treatments),
          },
        },
        waiting_periods: {
          initial_waiting_days: toNumber(req.body.initial_waiting_days, 30),
          pre_existing_diseases_days: toNumber(req.body.pre_existing_diseases_days, 365),
        },
        exclusions: toArray(req.body.exclusions),
        claim_requirements: {
          documents_required: toArray(req.body.documents_required),
          submission_timeline_days: toNumber(req.body.submission_timeline_days, 30),
          minimum_claim_amount: toNumber(req.body.minimum_claim_amount),
        },
        network_hospitals: toArray(req.body.network_hospitals),
        cashless_facilities: {
          available: req.body.cashless_available === true,
          network_only: req.body.cashless_network_only !== false,
          pre_approval_required: req.body.cashless_pre_approval === true,
          instant_approval_limit: toNumber(req.body.instant_approval_limit),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(201).json({ saved: true, policy });
  } catch (error) {
    next(error);
  }
});

router.post('/user-policies', async (req, res, next) => {
  try {
    required(req.body.member_id, 'member_id');
    required(req.body.policy_id, 'policy_id');
    required(req.body.enrollment_date, 'enrollment_date');

    const user = await UserData.findOne({ member_id: req.body.member_id });
    const policy = await PolicyData.findOne({ policy_id: req.body.policy_id });

    if (!user) {
      const error = new Error(`User ${req.body.member_id} was not found`);
      error.statusCode = 404;
      throw error;
    }

    if (!policy) {
      const error = new Error(`Policy ${req.body.policy_id} was not found`);
      error.statusCode = 404;
      throw error;
    }

    const userPolicy = await UserPolicy.findOneAndUpdate(
      { user_id: user._id, policy_id: policy._id },
      {
        user_id: user._id,
        policy_id: policy._id,
        enrollment_date: req.body.enrollment_date,
        status: req.body.status || 'Active',
        utilization: {
          total_claimed_amount_ytd: toNumber(req.body.total_claimed_amount_ytd),
          consultation_utilized: toNumber(req.body.consultation_utilized),
          diagnostic_utilized: toNumber(req.body.diagnostic_utilized),
          pharmacy_utilized: toNumber(req.body.pharmacy_utilized),
        },
      },
      { upsert: true, new: true, runValidators: true }
    )
      .populate('user_id', 'member_id member_name member_type')
      .populate('policy_id', 'policy_id policy_name');

    res.status(201).json({ linked: true, user_policy: userPolicy });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
