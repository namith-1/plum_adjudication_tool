const { UserPolicy, UserPolicyClaims } = require('../models');

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDecision(decision) {
  const allowed = ['APPROVED', 'PARTIAL', 'REJECTED', 'MANUAL_REVIEW', 'REQUEST_CLEAR_IMAGE'];

  if (allowed.includes(decision)) {
    return decision;
  }

  return 'MANUAL_REVIEW';
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createClaimId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CLM_${timestamp}_${suffix}`;
}

function buildDocumentRecords(files, extraction) {
  const fileRecords = (files || []).map((file) => ({
    file_name: file.originalname,
    mime_type: file.mimetype,
  }));

  if (fileRecords.length === 0) {
    return [
      {
        extracted_data: extraction,
      },
    ];
  }

  fileRecords[0].extracted_data = extraction;
  return fileRecords;
}

async function persistClaimResult({ precheck, extraction, adjudication, input, files }) {
  const decision = normalizeDecision(adjudication?.decision);
  const approvedAmount = toNumber(adjudication?.approved_amount);
  const treatmentDate = parseDate(precheck.claim?.treatment_date || input.treatment_date);
  const submissionDate = parseDate(precheck.claim?.submission_date || input.submission_date);

  const claim = await UserPolicyClaims.create({
    claim_id: createClaimId(),
    user_policy_id: precheck.user_policy.id,
    treatment_date: treatmentDate,
    submission_date: submissionDate,
    hospital_details: {
      name: input.hospital || input.hospital_name || 'Unknown',
      is_network_hospital: false,
    },
    cashless_request: input.cashless_request === 'true' || input.cashless_request === true,
    financials: {
      claimed_amount: toNumber(input.claim_amount),
    },
    documents: buildDocumentRecords(files, extraction),
    adjudication: {
      decision,
      approved_amount: approvedAmount,
      deductions: {
        copay_amount: toNumber(adjudication?.deductions?.copay_amount),
        network_discount: toNumber(adjudication?.deductions?.network_discount),
      },
      rejection_reasons: adjudication?.rejection_reasons || [],
      confidence_score: toNumber(adjudication?.confidence_score),
      flags: adjudication?.flags || [],
      notes: adjudication?.notes || adjudication?.next_steps || '',
      raw_result: adjudication,
    },
  });

  if (['APPROVED', 'PARTIAL'].includes(decision) && approvedAmount > 0) {
    await UserPolicy.updateOne(
      { _id: precheck.user_policy.id },
      {
        $inc: {
          'utilization.total_claimed_amount_ytd': approvedAmount,
        },
      }
    );
  }

  return claim;
}

module.exports = {
  persistClaimResult,
};
