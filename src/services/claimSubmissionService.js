const { extractOpdDocuments } = require('./grokExtractionService');
const { runAiAdjudication } = require('./claimAdjudicationService');
const { runClaimPrecheck } = require('./claimPrecheckService');
const { persistClaimResult } = require('./claimPersistenceService');
const { inferTreatmentDate } = require('./treatmentDateService');

function normalizeExtractionPayload(input) {
  const extraction = input.extraction || input.extracted_documents || input.extracted_json || input.claim_extraction;

  if (!extraction) {
    const error = new Error('extraction, extracted_documents, extracted_json, or claim_extraction is required');
    error.statusCode = 400;
    throw error;
  }

  if (extraction.claim_extraction) {
    return extraction;
  }

  return {
    claim_extraction: extraction,
  };
}

function isTruthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

async function submitClaimForAdjudication(input, files = []) {
  const extractionResult = await extractOpdDocuments(
    {
      documents: input.documents || [],
      instructions:
        input.instructions ||
        'Extract OPD documents with full unmapped_data, visual_markers, dates, patient details, diagnosis, prescription, bills, and confidence scores.',
    },
    files
  );
  const inferredTreatmentDate = inferTreatmentDate(extractionResult.extraction);

  if (!inferredTreatmentDate.treatment_date) {
    return {
      stage: 'DATE_EXTRACTION',
      precheck: null,
      extraction: extractionResult.extraction,
      adjudication: {
        decision: 'REQUEST_MORE_INFO',
        rejection_reasons: ['DATE_MISSING'],
        confidence_score: 0,
        notes: 'Could not extract a valid treatment/document date from uploaded documents.',
        next_steps: 'Upload documents or JSON/text content that includes visible prescription, bill, report, or pharmacy dates.',
      },
      inferred_treatment_date: inferredTreatmentDate,
    };
  }

  const claimInputWithDate = {
    ...input,
    adjudication_mode: input.adjudication_mode === 'strict' ? 'strict' : 'normal',
    treatment_date: inferredTreatmentDate.treatment_date,
  };
  const precheck = await runClaimPrecheck(claimInputWithDate);

  if (!precheck.passed) {
    return {
      stage: 'PRELIMINARY_ELIGIBILITY',
      precheck,
      extraction: extractionResult.extraction,
      adjudication: null,
      inferred_treatment_date: inferredTreatmentDate,
    };
  }

  const adjudication = await runAiAdjudication({
    precheck,
    extraction: extractionResult.extraction,
    claimInput: claimInputWithDate,
  });
  const savedClaim = await persistClaimResult({
    precheck,
    extraction: extractionResult.extraction,
    adjudication,
    input: claimInputWithDate,
    files,
  });

  return {
    stage: 'ADJUDICATION',
    claim_id: savedClaim.claim_id,
    saved_claim_id: savedClaim._id,
    claim_saved: true,
    utilization_updated: ['APPROVED', 'PARTIAL'].includes(savedClaim.adjudication.decision),
    inferred_treatment_date: inferredTreatmentDate,
    precheck,
    extraction: extractionResult.extraction,
    adjudication,
  };
}

async function submitExtractedJsonForAdjudication(input) {
  const extraction = normalizeExtractionPayload(input);
  const inferredTreatmentDate = inferTreatmentDate(extraction);

  if (!inferredTreatmentDate.treatment_date) {
    return {
      stage: 'DATE_EXTRACTION',
      precheck: null,
      extraction,
      adjudication: {
        decision: 'REQUEST_MORE_INFO',
        rejection_reasons: ['DATE_MISSING'],
        confidence_score: 0,
        notes: 'Could not find a valid treatment/document date in the provided extracted JSON.',
        next_steps: 'Provide extracted JSON with prescription, bill, report, or pharmacy dates.',
      },
      inferred_treatment_date: inferredTreatmentDate,
    };
  }

  const claimInputWithDate = {
    ...input,
    adjudication_mode: input.adjudication_mode === 'strict' ? 'strict' : 'normal',
    treatment_date: inferredTreatmentDate.treatment_date,
  };
  const precheck = await runClaimPrecheck(claimInputWithDate);

  if (!precheck.passed) {
    return {
      stage: 'PRELIMINARY_ELIGIBILITY',
      precheck,
      extraction,
      adjudication: null,
      inferred_treatment_date: inferredTreatmentDate,
    };
  }

  const adjudication = await runAiAdjudication({
    precheck,
    extraction,
    claimInput: claimInputWithDate,
  });
  const shouldPersist =
    isTruthy(input.update_db) ||
    (isTruthy(input.update_db_on_manual_review) && adjudication.decision === 'MANUAL_REVIEW');
  const savedClaim = shouldPersist
    ? await persistClaimResult({
        precheck,
        extraction,
        adjudication,
        input: claimInputWithDate,
        files: [],
      })
    : null;

  return {
    stage: 'DIRECT_JSON_ADJUDICATION',
    persisted: Boolean(savedClaim),
    claim_id: savedClaim?.claim_id || null,
    saved_claim_id: savedClaim?._id || null,
    utilization_updated: savedClaim ? ['APPROVED', 'PARTIAL'].includes(savedClaim.adjudication.decision) : false,
    inferred_treatment_date: inferredTreatmentDate,
    precheck,
    extraction,
    adjudication,
  };
}

async function saveManualReviewClaim(input) {
  const adjudication =
    input.adjudication?.decision === 'MANUAL_REVIEW'
      ? input.adjudication
      : input.precheck?.decision === 'MANUAL_REVIEW'
        ? {
            decision: 'MANUAL_REVIEW',
            approved_amount: 0,
            rejection_reasons: [],
            flags: input.precheck.flags || [],
            notes: input.precheck.notes,
            raw_result: input.precheck,
          }
        : null;

  if (!adjudication) {
    const error = new Error('Only MANUAL_REVIEW adjudications can be saved with this endpoint');
    error.statusCode = 400;
    throw error;
  }

  if (!input.precheck?.user_policy?.id || !input.precheck?.claim?.treatment_date) {
    const error = new Error('precheck with user_policy and claim date is required to save manual review');
    error.statusCode = 400;
    throw error;
  }

  if (!input.extraction) {
    const error = new Error('extraction from adjudication response is required');
    error.statusCode = 400;
    throw error;
  }

  const savedClaim = await persistClaimResult({
    precheck: input.precheck,
    extraction: input.extraction,
    adjudication,
    input: {
      ...(input.claim_input || {}),
      claim_amount: input.precheck.claim?.claim_amount,
      treatment_date: input.precheck.claim?.treatment_date,
      submission_date: input.precheck.claim?.submission_date,
    },
    files: [],
  });

  return {
    saved: true,
    claim_id: savedClaim.claim_id,
    saved_claim_id: savedClaim._id,
    utilization_updated: false,
  };
}

module.exports = {
  submitClaimForAdjudication,
  submitExtractedJsonForAdjudication,
  saveManualReviewClaim,
};
