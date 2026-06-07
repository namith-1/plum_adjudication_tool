const jaroWinklerSimilarity = require('talisman/metrics/jaro-winkler');
const doubleMetaphone = require('talisman/phonetics/double-metaphone');

const NAME_TITLE_TOKENS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'master',
  'baby',
  'dr',
  'doctor',
  'prof',
  'sri',
  'smt',
  'shri',
  'kumari',
]);

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function textIncludesAny(value, terms) {
  const text = JSON.stringify(value || {}).toLowerCase();
  return terms.some((term) => text.includes(term));
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value) {
  return normalizeName(value)
    .split(' ')
    .filter((token) => token.length > 1 && !NAME_TITLE_TOKENS.has(token));
}

function jaroWinkler(left, right) {
  const s1 = normalizeName(left).replace(/\s/g, '');
  const s2 = normalizeName(right).replace(/\s/g, '');

  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  return jaroWinklerSimilarity(s1, s2);
}

function phoneticLastNameScore(left, right) {
  const leftName = normalizeName(left).replace(/\s/g, '');
  const rightName = normalizeName(right).replace(/\s/g, '');

  if (!leftName && !rightName) return 1;
  if (!leftName || !rightName) return 0;

  const leftSounds = doubleMetaphone(leftName);
  const rightSounds = doubleMetaphone(rightName);
  const soundsMatch = leftSounds.some((sound) => sound && rightSounds.includes(sound));

  return soundsMatch ? 0.95 : jaroWinkler(leftName, rightName);
}

function splitName(value) {
  const tokens = nameTokens(value);

  return {
    first: tokens[0] || '',
    last: tokens.length > 1 ? tokens[tokens.length - 1] : '',
  };
}

function normalizeGender(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (['m', 'male', 'man'].includes(normalized)) return 'M';
  if (['f', 'female', 'woman'].includes(normalized)) return 'F';
  if (['o', 'other', 'non-binary', 'nonbinary'].includes(normalized)) return 'O';
  return 'U';
}

function normalizeDate(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const dayFirst = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);

  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  if (dayFirst) {
    return `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function dobScore(left, right) {
  const leftDate = normalizeDate(left);
  const rightDate = normalizeDate(right);

  if (!leftDate || !rightDate) return 0.5;
  if (leftDate === rightDate) return 1;

  const [leftYear, leftMonth, leftDay] = leftDate.split('-');
  const [rightYear, rightMonth, rightDay] = rightDate.split('-');

  if (leftYear === rightYear && leftMonth === rightDay && leftDay === rightMonth) {
    return 0.8;
  }

  return 0;
}

function genderScore(left, right) {
  const leftGender = normalizeGender(left);
  const rightGender = normalizeGender(right);

  if (leftGender === 'U' || rightGender === 'U') return 0.5;
  return leftGender === rightGender ? 1 : 0;
}

function patientMatchScore(dbMember, documentPatient) {
  const dbName = splitName(dbMember?.member_name);
  const docName = splitName(documentPatient?.name);
  const firstNameScore = dbName.first && docName.first ? jaroWinkler(dbName.first, docName.first) : 0.5;
  const lastNameScore = dbName.last && docName.last ? phoneticLastNameScore(dbName.last, docName.last) : 0.5;
  const dateOfBirthScore = dobScore(dbMember?.date_of_birth, documentPatient?.date_of_birth || documentPatient?.dob);
  const sexScore = genderScore(dbMember?.gender, documentPatient?.gender);
  const totalScore =
    firstNameScore * 0.2 +
    lastNameScore * 0.3 +
    dateOfBirthScore * 0.4 +
    sexScore * 0.1;

  return {
    first_name_score: Number(firstNameScore.toFixed(3)),
    last_name_score: Number(lastNameScore.toFixed(3)),
    dob_score: Number(dateOfBirthScore.toFixed(3)),
    gender_score: Number(sexScore.toFixed(3)),
    total_score: Number(totalScore.toFixed(3)),
    pass_threshold: 0.6,
    db_member_name: dbMember?.member_name || null,
    document_patient_name: documentPatient?.name || null,
    normalized_db_name: nameTokens(dbMember?.member_name).join(' '),
    normalized_document_name: nameTokens(documentPatient?.name).join(' '),
    db_dob: normalizeDate(dbMember?.date_of_birth),
    document_dob: normalizeDate(documentPatient?.date_of_birth || documentPatient?.dob),
    db_gender: normalizeGender(dbMember?.gender),
    document_gender: normalizeGender(documentPatient?.gender),
  };
}

function patientMatchDecision(score) {
  if (score >= 0.6) return 'PASS';
  return 'REJECT';
}


function getDocuments(extraction) {
  return extraction?.claim_extraction?.documents || {};
}

function getBillItems(extraction) {
  const documents = getDocuments(extraction);
  return [
    ...safeArray(documents.medical_bills).flatMap((bill) => safeArray(bill.line_items)),
    ...safeArray(documents.pharmacy_bills).flatMap((bill) => safeArray(bill.line_items)),
  ];
}

function getDocumentPatients(extraction) {
  const documents = getDocuments(extraction);
  const structuredPatients = [
    ...safeArray(documents.prescriptions).map((doc) => doc.patient_info),
    ...safeArray(documents.medical_bills).map((doc) => doc.patient_info),
    ...safeArray(documents.diagnostic_reports).map((doc) => doc.patient_info),
    ...safeArray(documents.pharmacy_bills).map((doc) => doc.patient_info),
  ].filter((patient) => String(patient?.name || '').trim());

  if (structuredPatients.length > 0) {
    return structuredPatients;
  }

  return [{ name: extraction?.claim_extraction?.summary?.consistent_patient_name }].filter((patient) =>
    String(patient?.name || '').trim()
  );
}

function addReason(reasons, reason) {
  return Array.from(new Set([...(reasons || []), reason]));
}

function addFlags(flags, nextFlags) {
  return Array.from(new Set([...(flags || []), ...nextFlags]));
}

function withGuardCheck(adjudication, key, check) {
  return {
    ...adjudication,
    checks: {
      ...(adjudication.checks || {}),
      [key]: check,
    },
  };
}

function rejectWith(adjudication, reason, notes, checkKey, evidence = []) {
  return withGuardCheck(
    {
      ...adjudication,
      decision: 'REJECTED',
      approved_amount: 0,
      rejection_reasons: addReason(adjudication.rejection_reasons, reason),
      notes: `${adjudication.notes || ''} Backend policy guard: ${notes}`.trim(),
    },
    checkKey,
    {
      status: 'failed',
      passed: false,
      reason: notes,
      evidence_used: evidence,
      failure_code: reason,
    }
  );
}

function manualReviewWith(adjudication, flags, notes, checkKey, evidence = []) {
  return withGuardCheck(
    {
      ...adjudication,
      decision: 'MANUAL_REVIEW',
      approved_amount: 0,
      flags: addFlags(adjudication.flags, flags),
      notes: `${adjudication.notes || ''} Backend policy guard: ${notes}`.trim(),
    },
    checkKey,
    {
      status: 'failed',
      passed: false,
      reason: notes,
      evidence_used: evidence,
      failure_code: flags[0],
    }
  );
}

function hasPrescriptionSupport(extraction) {
  return safeArray(getDocuments(extraction).prescriptions).length > 0;
}

function hasBill(extraction) {
  const documents = getDocuments(extraction);
  return (
    safeArray(documents.medical_bills).length > 0 ||
    safeArray(documents.pharmacy_bills).length > 0 ||
    safeArray(documents.diagnostic_reports).length > 0
  );
}

function hasHighValueMriOrCt(extraction) {
  return getBillItems(extraction).some((item) => {
    const text = `${item.description || ''} ${item.category || ''}`.toLowerCase();
    const amount = toNumber(item.amount || item.total_amount);
    return amount > 10000 && (text.includes('mri') || text.includes('ct scan') || text.includes('ct'));
  });
}

function capAmount(amount, limit) {
  const numericAmount = toNumber(amount);
  const numericLimit = toNumber(limit);
  return numericLimit > 0 ? Math.min(numericAmount, numericLimit) : numericAmount;
}

function getBackendAmountSummary(adjudication) {
  return adjudication.backend_amount_summary || {};
}

function calculateBackendApprovedAmount(adjudication, precheck, claimInput = {}) {
  const summary = getBackendAmountSummary(adjudication);
  const breakdown = summary.document_amount_breakdown || adjudication.document_amount_breakdown || {};
  const coverage = precheck.policy?.coverage_details || {};
  const claimRequirements = precheck.policy?.claim_requirements || {};
  const utilization = precheck.user_policy?.utilization || {};
  const requestedAmount = toNumber(
    claimInput.claim_amount ??
      precheck.claim?.claim_amount ??
      adjudication.claimed_amount_from_request ??
      summary.claimed_amount_from_request
  );

  const medicalTotal = toNumber(breakdown.medical_bill?.total ?? summary.medical_bill_total);
  const pharmacyTotal = toNumber(breakdown.pharmacy_bill?.total ?? summary.pharmacy_bill_total);
  const diagnosticTotal = toNumber(breakdown.diagnostic_report?.total ?? summary.diagnostic_bill_total);
  const procedureTotal = toNumber(breakdown.procedure?.total ?? summary.procedure_total);
  const otherTotal = toNumber(breakdown.other?.total);

  const cappedMedical = capAmount(medicalTotal, coverage.consultation_fees?.sub_limit);
  const cappedPharmacy = capAmount(pharmacyTotal, coverage.pharmacy?.sub_limit);
  const cappedDiagnostic = capAmount(diagnosticTotal, coverage.diagnostic_tests?.sub_limit);
  const cappedProcedure = procedureTotal;
  const cappedOther = otherTotal;
  const categoryEligibleTotal = cappedMedical + cappedPharmacy + cappedDiagnostic + cappedProcedure + cappedOther;
  const perClaimCapped = capAmount(categoryEligibleTotal, coverage.per_claim_limit);
  const remainingAnnualLimit = Math.max(toNumber(coverage.annual_limit) - toNumber(utilization.total_claimed_amount_ytd), 0);
  const annualCapped = remainingAnnualLimit > 0 ? Math.min(perClaimCapped, remainingAnnualLimit) : perClaimCapped;
  const policyCappedAmount = annualCapped;
  const finalApprovedAmount = requestedAmount > 0 ? Math.min(policyCappedAmount, requestedAmount) : policyCappedAmount;
  const minimumClaimAmount = toNumber(claimRequirements.minimum_claim_amount);
  const sublimitCapped = cappedMedical < medicalTotal || cappedPharmacy < pharmacyTotal || cappedDiagnostic < diagnosticTotal;
  const perClaimCappedApplied = perClaimCapped < categoryEligibleTotal;
  const annualCappedApplied = annualCapped < perClaimCapped;
  const requestedCapped = requestedAmount > 0 && requestedAmount < policyCappedAmount;
  const requestedExceedsClaimable = requestedAmount > 0 && requestedAmount > policyCappedAmount;

  return {
    extracted_total: medicalTotal + pharmacyTotal + diagnosticTotal + procedureTotal + otherTotal,
    category_eligible_total: categoryEligibleTotal,
    policy_capped_amount: Number(policyCappedAmount.toFixed(2)),
    requested_amount: requestedAmount,
    approved_amount: Number(finalApprovedAmount.toFixed(2)),
    minimum_claim_amount: minimumClaimAmount,
    per_claim_limit: toNumber(coverage.per_claim_limit),
    annual_limit: toNumber(coverage.annual_limit),
    remaining_annual_limit: remainingAnnualLimit,
    requested_capped: requestedCapped,
    requested_exceeds_claimable: requestedExceedsClaimable,
    limit_capped: sublimitCapped || perClaimCappedApplied || annualCappedApplied,
    sublimit_capped: sublimitCapped,
    per_claim_capped: perClaimCappedApplied,
    annual_capped: annualCappedApplied,
    caps_applied: {
      medical_bill: Number(cappedMedical.toFixed(2)),
      pharmacy_bill: Number(cappedPharmacy.toFixed(2)),
      diagnostic_report: Number(cappedDiagnostic.toFixed(2)),
      procedure: Number(cappedProcedure.toFixed(2)),
      other: Number(cappedOther.toFixed(2)),
      per_claim: Number(perClaimCapped.toFixed(2)),
      annual: Number(annualCapped.toFixed(2)),
    },
  };
}

function normalizeApprovedAmount(adjudication, precheck, claimInput = {}) {
  const calculated = calculateBackendApprovedAmount(adjudication, precheck, claimInput);
  const amountOnlyCodes = new Set([
    'PER_CLAIM_EXCEEDED',
    'BELOW_MIN_AMOUNT',
    'AMOUNT_MISMATCH',
    'CLAIM_AMOUNT_MISMATCH',
    'CALCULATED_AMOUNT_MISMATCH',
  ]);
  const cleanedRejectionReasons = safeArray(adjudication.rejection_reasons).filter(
    (reason) => !amountOnlyCodes.has(String(reason))
  );

  if (calculated.extracted_total <= 0 || calculated.category_eligible_total <= 0) {
    return rejectWith(
      adjudication,
      'NO_CLAIMABLE_AMOUNT',
      'Backend could not find any claimable bill amount from extracted documents.',
      'amount_match',
      [`extracted_total=${calculated.extracted_total}`]
    );
  }

  if (calculated.minimum_claim_amount > 0 && calculated.approved_amount < calculated.minimum_claim_amount) {
    return rejectWith(
      adjudication,
      'BELOW_MIN_AMOUNT',
      `Calculated eligible amount is below minimum claim amount of ${calculated.minimum_claim_amount}.`,
      'amount_match',
      [`approved_amount=${calculated.approved_amount}`, `minimum_claim_amount=${calculated.minimum_claim_amount}`]
    );
  }

  const limitCapped = calculated.limit_capped;
  const requestedExceedsClaimable = calculated.requested_exceeds_claimable;
  const hasRejectedItems =
    safeArray(adjudication.rejected_items).length > 0 ||
    safeArray(adjudication.non_claimable_procedures).length > 0 ||
    cleanedRejectionReasons.length > 0;
  const requestedAmount = calculated.requested_amount;
  const amountRemark = [
    `Approved amount is ${calculated.approved_amount}.`,
    `Requested amount was ${requestedAmount}.`,
    `Document claimable amount before policy/request caps was ${Number(calculated.category_eligible_total.toFixed(2))}.`,
    `Policy-capped claimable amount was ${calculated.policy_capped_amount}.`,
    requestedExceedsClaimable ? 'Requested amount was higher than the claimable amount, so the claim is partial.' : null,
    calculated.requested_capped ? 'Requested amount was lower than the claimable amount, so approval is limited to the requested amount.' : null,
    limitCapped ? 'Policy per-claim, annual, or sublimit cap was applied.' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return withGuardCheck(
    {
      ...adjudication,
      decision: hasRejectedItems || limitCapped || requestedExceedsClaimable ? 'PARTIAL' : 'APPROVED',
      rejection_reasons: cleanedRejectionReasons,
      claimed_amount_from_request: requestedAmount,
      requested_amount: requestedAmount,
      approved_amount: calculated.approved_amount,
      calculated_claimable_amount: Number(calculated.category_eligible_total.toFixed(2)),
      total_extracted_bill_amount: calculated.extracted_total,
      amount_consistency: {
        ...(adjudication.amount_consistency || {}),
        passed: true,
        difference: requestedAmount > 0 ? Number((calculated.category_eligible_total - requestedAmount).toFixed(2)) : 0,
        amount_relationship:
          requestedAmount === 0
            ? 'requested_amount_missing'
            : calculated.category_eligible_total === requestedAmount
              ? 'same'
              : calculated.category_eligible_total < requestedAmount
                ? 'claimable_less_than_requested'
                : 'claimable_more_than_requested',
        amount_remark: amountRemark,
        notes: 'Backend recalculated final approval as min(requested amount, document claimable amount, policy caps, annual remaining limit).',
      },
      deductions: {
        ...(adjudication.deductions || {}),
        limit_cap_amount: calculated.policy_capped_amount < calculated.category_eligible_total
          ? Number((calculated.category_eligible_total - calculated.policy_capped_amount).toFixed(2))
          : toNumber(adjudication.deductions?.limit_cap_amount),
        requested_amount_cap: calculated.requested_capped
          ? Number((calculated.policy_capped_amount - calculated.approved_amount).toFixed(2))
          : toNumber(adjudication.deductions?.requested_amount_cap),
      },
      tags: limitCapped ? addFlags(adjudication.tags, ['LIMIT_CAP']) : adjudication.tags || [],
      backend_amount_recalculation: calculated,
    },
    'amount_match',
    {
      status: 'passed',
      passed: true,
      reason: 'Backend approved amount was recalculated as min(requested amount, extracted claimable amount, policy caps, and annual remaining limit).',
      evidence_used: [
        `requested_amount=${requestedAmount}`,
        `extracted_total=${calculated.extracted_total}`,
        `category_eligible_total=${calculated.category_eligible_total}`,
        `policy_capped_amount=${calculated.policy_capped_amount}`,
        `approved_amount=${calculated.approved_amount}`,
      ],
      failure_code: null,
    }
  );
}

function isAmountOnlyRejection(adjudication) {
  if (adjudication?.decision !== 'REJECTED') return false;

  const amountOnlyCodes = new Set([
    'PER_CLAIM_EXCEEDED',
    'BELOW_MIN_AMOUNT',
    'AMOUNT_MISMATCH',
    'CLAIM_AMOUNT_MISMATCH',
    'CALCULATED_AMOUNT_MISMATCH',
  ]);
  const reasons = safeArray(adjudication.rejection_reasons);

  return reasons.length > 0 && reasons.every((reason) => amountOnlyCodes.has(String(reason)));
}

function applyPolicyGuard(adjudication, { precheck, extraction, claimInput }) {
  if (!adjudication || (!['APPROVED', 'PARTIAL'].includes(adjudication.decision) && !isAmountOnlyRejection(adjudication))) {
    return adjudication;
  }

  const policy = precheck.policy || {};
  const previousAcceptedClaimsSameDay = toNumber(
    claimInput.previous_accepted_claims_same_day || claimInput.accepted_claims_same_day
  );
  const patientMatchResults = getDocumentPatients(extraction).map((patient) => ({
    patient,
    score: patientMatchScore(precheck.member, patient),
  }));
  const rejectedPatientMatches = patientMatchResults.filter((result) => patientMatchDecision(result.score.total_score) === 'REJECT');

  if (rejectedPatientMatches.length > 0) {
    return rejectWith(
      adjudication,
      'PATIENT_MISMATCH',
      'Patient identity score is below 0.60 for one or more documents.',
      'patient_match',
      rejectedPatientMatches.map((result) => JSON.stringify(result.score))
    );
  }

  if (previousAcceptedClaimsSameDay >= 1) {
    return manualReviewWith(
      adjudication,
      ['Multiple claims same day', 'Unusual pattern detected'],
      'One or more previously accepted same-day claims were declared in the claim input, so this needs duplicate/fraud review.',
      'fraud_or_manual_review_flags',
      [`previous_accepted_claims_same_day=${previousAcceptedClaimsSameDay}`]
    );
  }

  if (!hasPrescriptionSupport(extraction) && hasBill(extraction)) {
    return rejectWith(
      adjudication,
      'MISSING_DOCUMENTS',
      'A prescription from a registered doctor is required to support OPD bill items.',
      'required_documents',
      ['prescriptions=0', 'bill_or_report_present=true']
    );
  }

  if (hasHighValueMriOrCt(extraction) && !claimInput.pre_authorized && !claimInput.pre_authorization_id) {
    return rejectWith(
      adjudication,
      'PRE_AUTH_MISSING',
      'MRI/CT diagnostic claims above 10000 require pre-authorization.',
      'diagnostic_bill_has_investigation_advice',
      ['high_value_mri_or_ct=true', 'pre_authorized=false']
    );
  }

  if (textIncludesAny(extraction, ['weight loss', 'obesity', 'bariatric', 'diet plan'])) {
    return rejectWith(
      adjudication,
      'SERVICE_NOT_COVERED',
      'Weight loss, obesity, bariatric, and diet-plan treatments are excluded from coverage.',
      'coverage_match',
      ['exclusion_match=weight_loss_or_obesity']
    );
  }

  return normalizeApprovedAmount(adjudication, precheck, claimInput);
}

module.exports = {
  applyPolicyGuard,
};
