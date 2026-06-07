const { UserData, UserPolicy, UserPolicyClaims } = require('../models');

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseDate(value, fieldName) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${fieldName} must be a valid date`);
    error.statusCode = 400;
    throw error;
  }

  return date;
}

function daysBetween(startDate, endDate) {
  return Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function dayRange(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function calculateAgeOnDate(dateOfBirth, targetDate) {
  if (!dateOfBirth) {
    return null;
  }

  const dob = new Date(dateOfBirth);

  if (Number.isNaN(dob.getTime())) {
    return null;
  }

  let age = targetDate.getFullYear() - dob.getFullYear();
  const hasBirthdayPassed =
    targetDate.getMonth() > dob.getMonth() ||
    (targetDate.getMonth() === dob.getMonth() && targetDate.getDate() >= dob.getDate());

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age;
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function reject(reason, notes, extras = {}) {
  return {
    passed: false,
    decision: 'REJECTED',
    rejection_reasons: [reason],
    notes,
    ...extras,
  };
}

function manualReview(reason, notes, extras = {}) {
  return {
    passed: false,
    decision: 'MANUAL_REVIEW',
    rejection_reasons: [],
    flags: [reason],
    notes,
    ...extras,
  };
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

function getWaitingPeriod(policy, conditions) {
  const waitingPeriods = policy.waiting_periods || {};
  const specificAilments = waitingPeriods.specific_ailments;
  let maxWaitingDays = waitingPeriods.initial_waiting_days || waitingPeriods.initial_waiting || 0;
  let matchedCondition = null;

  for (const condition of conditions) {
    const conditionKey = normalizeName(condition).replace(/\s+/g, '_');
    const directValue =
      typeof specificAilments?.get === 'function'
        ? specificAilments.get(conditionKey) || specificAilments.get(normalizeName(condition))
        : specificAilments?.[conditionKey] || specificAilments?.[normalizeName(condition)];

    if (directValue && directValue > maxWaitingDays) {
      maxWaitingDays = directValue;
      matchedCondition = condition;
    }
  }

  return { waitingDays: maxWaitingDays, matchedCondition };
}

async function runClaimPrecheck(input) {
  const memberId = input.member_id || input.user_id;
  const memberName = input.member_name || input.name;
  const requiredFields = {
    member_id: memberId,
    member_name: memberName,
    claim_amount: input.claim_amount,
  };
  const missingFields = Object.entries(requiredFields)
    .filter(([, value]) => value === undefined || value === null || value === '')
    .map(([key]) => key);

  if (missingFields.length > 0) {
    const error = new Error(`Missing required fields: ${missingFields.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  const treatmentDate = parseDate(input.treatment_date, 'treatment_date');
  const claimAmount = Number(input.claim_amount);

  if (!Number.isFinite(claimAmount) || claimAmount <= 0) {
    const error = new Error('claim_amount must be a positive number');
    error.statusCode = 400;
    throw error;
  }

  if (treatmentDate > new Date()) {
    return reject('INVALID_TREATMENT_DATE', 'Treatment date cannot be in the future.');
  }

  const user = await UserData.findOne({ member_id: memberId });

  if (!user) {
    return reject('MEMBER_NOT_COVERED', `No covered member found for member_id ${memberId}.`);
  }

  if (normalizeName(user.member_name) !== normalizeName(memberName)) {
    return reject('PATIENT_MISMATCH', 'Submitted member name does not match policy records.', {
      member: {
        member_id: user.member_id,
        member_name: user.member_name,
      },
    });
  }

  const activePolicyMatch = await findActiveUserPolicy(user);

  if (!activePolicyMatch) {
    return reject('POLICY_INACTIVE', 'No active policy is linked to this member.', {
      member: {
        member_id: user.member_id,
        member_name: user.member_name,
        member_type: user.member_type,
      },
    });
  }

  const { userPolicy, coverageSource } = activePolicyMatch;
  const policy = userPolicy.policy_id;

  if (!policy) {
    return reject('POLICY_INACTIVE', 'Linked policy record was not found.');
  }

  if (policy.effective_date && new Date(policy.effective_date) > treatmentDate) {
    return reject('POLICY_INACTIVE', 'Policy was not active on the treatment date.', {
      policy_id: policy.policy_id,
      effective_date: formatDate(new Date(policy.effective_date)),
    });
  }

  const requestConditions = toArray(input.previous_medical_conditions || input.known_conditions);
  const dbConditions = user.medical_history?.pre_existing_conditions || [];
  const knownConditions = Array.from(new Set([...dbConditions, ...requestConditions]));
  const { waitingDays, matchedCondition } = getWaitingPeriod(policy, knownConditions);
  const activeFromDate = userPolicy.enrollment_date || user.join_date;
  const waitingDaysCompleted = daysBetween(new Date(activeFromDate), treatmentDate);

  if (waitingDaysCompleted < waitingDays) {
    return reject(
      'WAITING_PERIOD',
      matchedCondition
        ? `${matchedCondition} waiting period of ${waitingDays} days is not completed.`
        : `Initial waiting period of ${waitingDays} days is not completed.`,
      {
        eligible_from: formatDate(addDays(new Date(activeFromDate), waitingDays)),
        matched_previous_condition: matchedCondition,
      }
    );
  }

  const submissionDate = input.submission_date ? parseDate(input.submission_date, 'submission_date') : new Date();
  const submissionTimelineDays = policy.claim_requirements?.submission_timeline_days || 30;
  const daysAfterTreatment = daysBetween(treatmentDate, submissionDate);
  const submissionDateCheck = {
    treatment_date: formatDate(treatmentDate),
    submission_date: formatDate(submissionDate),
    submission_timeline_days: submissionTimelineDays,
    days_after_treatment: daysAfterTreatment,
    passed: daysAfterTreatment <= submissionTimelineDays,
  };

  if (daysAfterTreatment > submissionTimelineDays) {
    return reject('LATE_SUBMISSION', `Claim submitted after ${submissionTimelineDays}-day timeline.`, {
      submission_date_check: submissionDateCheck,
    });
  }

  if (input.ignore_duplicate_claims !== true && input.ignore_duplicate_claims !== 'true') {
    const { start: treatmentDayStart, end: treatmentDayEnd } = dayRange(treatmentDate);
    const acceptedClaim = await UserPolicyClaims.findOne({
      user_policy_id: userPolicy._id,
      treatment_date: { $gte: treatmentDayStart, $lt: treatmentDayEnd },
      'adjudication.decision': { $in: ['APPROVED', 'PARTIAL'] },
    }).sort({ createdAt: -1 });

    if (acceptedClaim) {
      return manualReview('DUPLICATE_CLAIM_SAME_TREATMENT_DATE', 'An accepted claim for this member and treatment date already exists. Send to manual review for duplicate/fraud assessment.', {
        member: {
          id: user._id,
          member_id: user.member_id,
          member_name: user.member_name,
          date_of_birth: user.date_of_birth,
          age_at_treatment: calculateAgeOnDate(user.date_of_birth, treatmentDate),
          gender: user.gender,
          member_type: user.member_type,
          join_date: user.join_date,
        },
        user_policy: {
          id: userPolicy._id,
          status: userPolicy.status,
          enrollment_date: userPolicy.enrollment_date,
          utilization: userPolicy.utilization,
          coverage_source: coverageSource,
        },
        policy: policy.toObject ? policy.toObject() : policy,
        claim: {
          claim_amount: claimAmount,
          treatment_date: formatDate(treatmentDate),
          previous_medical_conditions: knownConditions,
          submission_date: formatDate(submissionDate),
          submission_date_check: submissionDateCheck,
        },
        existing_claim: {
          claim_id: acceptedClaim.claim_id,
          decision: acceptedClaim.adjudication?.decision,
          approved_amount: acceptedClaim.adjudication?.approved_amount,
          created_at: acceptedClaim.createdAt,
        },
      });
    }

    const unsuccessfulAttemptCount = await UserPolicyClaims.countDocuments({
      user_policy_id: userPolicy._id,
      treatment_date: { $gte: treatmentDayStart, $lt: treatmentDayEnd },
      'adjudication.decision': {
        $in: ['PENDING', 'REJECTED', 'MANUAL_REVIEW', 'REQUEST_CLEAR_IMAGE', 'REQUEST_MORE_INFO'],
      },
    });

    if (unsuccessfulAttemptCount >= 10) {
      return reject('MAX_UNSUCCESSFUL_ATTEMPTS_SAME_TREATMENT_DATE', 'Maximum unsuccessful claim attempts reached for this member and treatment date. A maximum of 10 unsuccessful submissions is allowed before a successful claim.', {
        claim_attempts: {
          treatment_date: formatDate(treatmentDate),
          unsuccessful_attempt_count: unsuccessfulAttemptCount,
          max_unsuccessful_attempts: 10,
        },
      });
    }
  }

  const annualLimit = policy.coverage_details?.annual_limit;
  const perClaimLimit = policy.coverage_details?.per_claim_limit;
  const minimumClaimAmount = policy.claim_requirements?.minimum_claim_amount || 0;
  const totalClaimedYtd = userPolicy.utilization?.total_claimed_amount_ytd || 0;
  const precheckWarnings = [];

  if (minimumClaimAmount && claimAmount < minimumClaimAmount) {
    return reject('BELOW_MIN_AMOUNT', `Claim amount is below minimum claim amount of ${minimumClaimAmount}.`, {
      minimum_claim_amount: minimumClaimAmount,
    });
  }

  if (perClaimLimit && claimAmount > perClaimLimit) {
    precheckWarnings.push({
      code: 'PER_CLAIM_EXCEEDED',
      notes: `Requested claim amount exceeds per-claim limit of ${perClaimLimit}. Do not reject only for this. AI adjudication should approve the calculated eligible amount and add an amount remark.`,
      per_claim_limit: perClaimLimit,
    });
  }

  if (annualLimit && totalClaimedYtd >= annualLimit) {
    return reject('ANNUAL_LIMIT_EXHAUSTED', 'Annual policy limit is already exhausted.', {
      annual_limit: annualLimit,
      total_claimed_amount_ytd: totalClaimedYtd,
      remaining_annual_limit: 0,
    });
  }

  if (annualLimit && totalClaimedYtd + claimAmount > annualLimit) {
    precheckWarnings.push({
      code: 'ANNUAL_LIMIT_EXCEEDED',
      notes: 'Requested claim amount exceeds remaining annual limit. Do not reject only for this. AI adjudication should approve the calculated eligible amount up to remaining annual limit and add an amount remark.',
      annual_limit: annualLimit,
      total_claimed_amount_ytd: totalClaimedYtd,
      remaining_annual_limit: Math.max(annualLimit - totalClaimedYtd, 0),
    });
  }

  return {
    passed: true,
    decision: 'PRELIMINARY_ELIGIBILITY_PASSED',
    notes:
      precheckWarnings.length > 0
        ? 'User, active policy, treatment date, and waiting period passed. Amount warnings will be handled in adjudication.'
        : 'User, active policy, treatment date, waiting period, and basic amount checks passed.',
    warnings: precheckWarnings,
    member: {
      id: user._id,
      member_id: user.member_id,
      member_name: user.member_name,
      date_of_birth: user.date_of_birth,
      age_at_treatment: calculateAgeOnDate(user.date_of_birth, treatmentDate),
      gender: user.gender,
      member_type: user.member_type,
      join_date: user.join_date,
    },
    user_policy: {
      id: userPolicy._id,
      status: userPolicy.status,
      enrollment_date: userPolicy.enrollment_date,
      utilization: userPolicy.utilization,
      coverage_source: coverageSource,
    },
    policy: policy.toObject ? policy.toObject() : policy,
    claim: {
      claim_amount: claimAmount,
      treatment_date: formatDate(treatmentDate),
      previous_medical_conditions: knownConditions,
      submission_date: formatDate(submissionDate),
      submission_date_check: submissionDateCheck,
      amount_limit_check: {
        minimum_claim_amount: minimumClaimAmount,
        per_claim_limit: perClaimLimit,
        annual_limit: annualLimit,
        total_claimed_amount_ytd: totalClaimedYtd,
        remaining_annual_limit: annualLimit ? Math.max(annualLimit - totalClaimedYtd, 0) : null,
      },
    },
  };
}

module.exports = {
  runClaimPrecheck,
};
