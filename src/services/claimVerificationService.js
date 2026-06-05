const { UserData, UserPolicy } = require('../models');

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function findActiveUserPolicy(user) {
  const directPolicy = await UserPolicy.findOne({
    user_id: user._id,
    status: 'Active',
  }).populate('policy_id');

  if (directPolicy) {
    return { userPolicy: directPolicy, coverageSource: 'DIRECT' };
  }

  if (user.member_type !== 'Dependent' || !user.primary_member_id) {
    return null;
  }

  const primaryPolicy = await UserPolicy.findOne({
    user_id: user.primary_member_id,
    status: 'Active',
  }).populate('policy_id');

  if (!primaryPolicy) {
    return null;
  }

  return { userPolicy: primaryPolicy, coverageSource: 'PRIMARY_MEMBER' };
}

function buildRejectedResponse(reason, notes, extras = {}) {
  return {
    eligible: false,
    decision: 'REJECTED',
    approved_amount: 0,
    rejection_reasons: [reason],
    confidence_score: 1,
    notes,
    ...extras,
  };
}

async function verifyUserPolicy(input) {
  const requiredFields = ['member_id', 'member_name'];
  const missingFields = requiredFields.filter((field) => input[field] === undefined || input[field] === null || input[field] === '');

  if (missingFields.length > 0) {
    const error = new Error(`Missing required fields: ${missingFields.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  const user = await UserData.findOne({ member_id: input.member_id });

  if (!user) {
    return buildRejectedResponse(
      'MEMBER_NOT_COVERED',
      `No covered member found for member_id ${input.member_id}.`
    );
  }

  if (normalizeName(user.member_name) !== normalizeName(input.member_name)) {
    return buildRejectedResponse(
      'PATIENT_MISMATCH',
      'Submitted member name does not match policy records.',
      {
        covered_member: false,
        member: {
          member_id: user.member_id,
          member_name: user.member_name,
        },
      }
    );
  }

  const activePolicyMatch = await findActiveUserPolicy(user);

  if (!activePolicyMatch) {
    return {
      verified_user: true,
      covered_member: true,
      policy_active: false,
      decision: 'REJECTED',
      rejection_reasons: ['POLICY_INACTIVE'],
      notes: 'No active policy is linked to this member.',
      member: {
        member_id: user.member_id,
        member_name: user.member_name,
        member_type: user.member_type,
      },
    };
  }

  const { userPolicy, coverageSource } = activePolicyMatch;
  const policy = userPolicy.policy_id;

  return {
    verified_user: true,
    covered_member: true,
    coverage_source: coverageSource,
    policy_active: true,
    decision: 'VERIFIED',
    notes: 'User is verified and has an active policy.',
    policy: policy
      ? {
          policy_id: policy.policy_id,
          policy_name: policy.policy_name,
        }
      : null,
    member: {
      member_id: user.member_id,
      member_name: user.member_name,
      member_type: user.member_type,
    },
  };
}

module.exports = {
  verifyUserPolicy,
};
