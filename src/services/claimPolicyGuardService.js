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
    .filter((token) => token.length > 1);
}

function jaroWinkler(left, right) {
  const s1 = normalizeName(left).replace(/\s/g, '');
  const s2 = normalizeName(right).replace(/\s/g, '');

  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const matchDistance = Math.max(Math.floor(Math.max(s1.length, s2.length) / 2) - 1, 0);
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);
  let matches = 0;

  for (let i = 0; i < s1.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j += 1) {
      if (s2Matches[j] || s1[i] !== s2[j]) {
        continue;
      }

      s1Matches[i] = true;
      s2Matches[j] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let cursor = 0;

  for (let i = 0; i < s1.length; i += 1) {
    if (!s1Matches[i]) {
      continue;
    }

    while (!s2Matches[cursor]) {
      cursor += 1;
    }

    if (s1[i] !== s2[cursor]) {
      transpositions += 1;
    }

    cursor += 1;
  }

  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
  const prefixLength = Math.min(
    4,
    [...s1].findIndex((char, index) => char !== s2[index]) === -1
      ? Math.min(s1.length, s2.length)
      : [...s1].findIndex((char, index) => char !== s2[index])
  );

  return jaro + prefixLength * 0.1 * (1 - jaro);
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
  const lastNameScore = dbName.last && docName.last ? jaroWinkler(dbName.last, docName.last) : 0.5;
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
    db_member_name: dbMember?.member_name || null,
    document_patient_name: documentPatient?.name || null,
    db_dob: normalizeDate(dbMember?.date_of_birth),
    document_dob: normalizeDate(documentPatient?.date_of_birth || documentPatient?.dob),
    db_gender: normalizeGender(dbMember?.gender),
    document_gender: normalizeGender(documentPatient?.gender),
  };
}

function patientMatchDecision(score) {
  if (score >= 0.85) return 'PASS';
  if (score >= 0.7) return 'MANUAL_REVIEW';
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

function applyPolicyGuard(adjudication, { precheck, extraction, claimInput }) {
  if (!adjudication || !['APPROVED', 'PARTIAL'].includes(adjudication.decision)) {
    return adjudication;
  }

  const policy = precheck.policy || {};
  const perClaimLimit = toNumber(policy.coverage_details?.per_claim_limit);
  const requestedAmount = toNumber(claimInput.claim_amount);
  const previousClaimsSameDay = toNumber(claimInput.previous_claims_same_day);
  const patientMatchResults = getDocumentPatients(extraction).map((patient) => ({
    patient,
    score: patientMatchScore(precheck.member, patient),
  }));
  const rejectedPatientMatches = patientMatchResults.filter((result) => patientMatchDecision(result.score.total_score) === 'REJECT');
  const manualReviewPatientMatches = patientMatchResults.filter((result) => patientMatchDecision(result.score.total_score) === 'MANUAL_REVIEW');

  if (rejectedPatientMatches.length > 0) {
    return rejectWith(
      adjudication,
      'PATIENT_MISMATCH',
      'Patient identity score is below 0.70 for one or more documents.',
      'patient_match',
      rejectedPatientMatches.map((result) => JSON.stringify(result.score))
    );
  }

  if (manualReviewPatientMatches.length > 0) {
    return manualReviewWith(
      adjudication,
      ['PATIENT_MATCH_MANUAL_REVIEW'],
      'Patient identity score is between 0.70 and 0.84 for one or more documents.',
      'patient_match',
      manualReviewPatientMatches.map((result) => JSON.stringify(result.score))
    );
  }

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
