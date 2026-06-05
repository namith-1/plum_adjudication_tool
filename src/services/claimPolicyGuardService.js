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

function applyPolicyGuard(adjudication, { precheck, extraction, claimInput }) {
  if (!adjudication || !['APPROVED', 'PARTIAL'].includes(adjudication.decision)) {
    return adjudication;
  }

  const policy = precheck.policy || {};
  const perClaimLimit = toNumber(policy.coverage_details?.per_claim_limit);
  const requestedAmount = toNumber(claimInput.claim_amount);
  const previousClaimsSameDay = toNumber(claimInput.previous_claims_same_day);

  if (previousClaimsSameDay >= 2) {
    return manualReviewWith(
      adjudication,
      ['Multiple claims same day', 'Unusual pattern detected'],
      'Multiple same-day claims were declared in the claim input, so this needs duplicate/fraud review.',
      'fraud_or_manual_review_flags',
      [`previous_claims_same_day=${previousClaimsSameDay}`]
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

  if (perClaimLimit && requestedAmount > perClaimLimit) {
    return rejectWith(
      adjudication,
      'PER_CLAIM_EXCEEDED',
      `Claim amount exceeds per-claim limit of ${perClaimLimit}.`,
      'amount_match',
      [`claim_amount=${requestedAmount}`, `per_claim_limit=${perClaimLimit}`]
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

  return adjudication;
}

module.exports = {
  applyPolicyGuard,
};
