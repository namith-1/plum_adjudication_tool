const CLAIM_ADJUDICATION_PROMPT = require('../prompts/claimAdjudicationPrompt');
const { callGroqJsonWithRetry } = require('./groqClient');
const { UserPolicyClaims } = require('../models');
const { summarizeExtraction, detectClaimTopics } = require('./claimSummaryService');
const { buildRagContext } = require('./ragContextService');
const { reviewClaimEvidence, applyEvidenceReview } = require('./claimEvidenceReviewService');
const { applyPolicyGuard } = require('./claimPolicyGuardService');

function collectConfidenceScores(value, scores = []) {
  if (!value || typeof value !== 'object') {
    return scores;
  }

  if (typeof value.overall_confidence_score === 'number') {
    scores.push(value.overall_confidence_score);
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      child.forEach((item) => collectConfidenceScores(item, scores));
    } else if (child && typeof child === 'object') {
      collectConfidenceScores(child, scores);
    }
  }

  return scores;
}

function countMeaningfulValues(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed && trimmed !== 'String' && trimmed !== 'YYYY-MM-DD' ? 1 : 0;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return 1;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countMeaningfulValues(item), 0);
  }

  if (typeof value === 'object') {
    return Object.values(value).reduce((total, item) => total + countMeaningfulValues(item), 0);
  }

  return 0;
}

function hasPoorDocumentQuality(extraction) {
  const serialized = JSON.stringify(extraction || {}).toLowerCase();
  const scores = collectConfidenceScores(extraction);
  const minScore = scores.length > 0 ? Math.min(...scores) : null;
  const meaningfulValues = countMeaningfulValues(extraction);

  return {
    failed:
      !extraction ||
      (minScore !== null && minScore < 0.7) ||
      serialized.includes('"blur_level":"high"') ||
      serialized.includes('"is_cropped_or_cut_off":true'),
    min_confidence_score: minScore,
    meaningful_values: meaningfulValues,
  };
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getDocuments(extraction, key) {
  return extraction?.claim_extraction?.documents?.[key] || [];
}

function sumLineItemAmounts(documents, amountKey = 'amount') {
  return documents.reduce((total, document) => {
    const lineItems = document.line_items || [];
    return (
      total +
      lineItems.reduce((lineTotal, item) => lineTotal + toNumber(item[amountKey]), 0)
    );
  }, 0);
}

function summarizeExtractedAmounts(extraction, requestedClaimAmount) {
  const medicalBills = getDocuments(extraction, 'medical_bills');
  const pharmacyBills = getDocuments(extraction, 'pharmacy_bills');
  const medicalBillTotal =
    medicalBills.reduce((total, bill) => total + toNumber(bill.financials?.total_amount), 0) ||
    sumLineItemAmounts(medicalBills);
  const pharmacyBillTotal =
    pharmacyBills.reduce((total, bill) => total + toNumber(bill.financials?.net_payable || bill.financials?.total_amount), 0) ||
    sumLineItemAmounts(pharmacyBills, 'total_amount');
  const totalExtractedBillAmount = medicalBillTotal + pharmacyBillTotal;
  const requestedAmount = toNumber(requestedClaimAmount);

  return {
    claimed_amount_from_request: requestedAmount,
    medical_bill_total: medicalBillTotal,
    pharmacy_bill_total: pharmacyBillTotal,
    total_extracted_bill_amount: totalExtractedBillAmount,
    difference_from_requested: totalExtractedBillAmount - requestedAmount,
    amount_matches_request: requestedAmount === 0 ? null : Math.abs(totalExtractedBillAmount - requestedAmount) <= 1,
  };
}

async function runAiAdjudication({ precheck, extraction, claimInput }) {
  const adjudicationMode = claimInput.adjudication_mode === 'strict' ? 'strict' : 'normal';
  const quality = hasPoorDocumentQuality(extraction);
  const amount_summary = summarizeExtractedAmounts(extraction, claimInput.claim_amount);
  const evidenceReview = reviewClaimEvidence(extraction, { mode: adjudicationMode });

  if (quality.failed) {
    return {
      decision: 'REQUEST_CLEAR_IMAGE',
      approved_amount: 0,
      rejection_reasons: ['ILLEGIBLE_DOCUMENTS'],
      confidence_score: quality.min_confidence_score ?? 0,
      notes:
        !extraction
          ? 'No extraction output was available for adjudication.'
          : 'Document extraction quality is too low for adjudication.',
      next_steps: 'Upload clearer, uncropped document images and try again.',
      checks: {
        document_quality: {
          status: 'failed',
          passed: false,
          reason:
            !extraction
              ? 'No extraction output was available.'
              : 'Extraction confidence, blur, or crop indicators failed quality threshold.',
          evidence_used: [
            `min_confidence_score=${quality.min_confidence_score ?? 'unknown'}`,
            `meaningful_values=${quality.meaningful_values}`,
          ],
          failure_code: 'ILLEGIBLE_DOCUMENTS',
        },
      },
      amount_summary,
      extraction,
    };
  }

  const claimSummary = summarizeExtraction(extraction);
  const topics = detectClaimTopics(claimSummary);
  const ragContext = buildRagContext({
    policy: precheck.policy,
    topics,
  });
  const previousClaims = await UserPolicyClaims.find({
    user_policy_id: precheck.user_policy.id,
  })
    .sort({ treatment_date: -1, createdAt: -1 })
    .limit(5)
    .select('claim_id treatment_date submission_date financials adjudication.decision adjudication.approved_amount adjudication.rejection_reasons adjudication.flags createdAt')
    .lean();
  const groqResult = await callGroqJsonWithRetry([
    {
      role: 'system',
      content: CLAIM_ADJUDICATION_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          claim_input: claimInput,
          member_from_db: precheck.member,
          user_policy_from_db: {
            id: precheck.user_policy.id,
            status: precheck.user_policy.status,
            enrollment_date: precheck.user_policy.enrollment_date,
            utilization: precheck.user_policy.utilization,
          },
          previous_claims_for_user_policy: previousClaims,
          claim_summary: claimSummary,
          rag_context: ragContext,
          backend_amount_summary: amount_summary,
          adjudication_mode: adjudicationMode,
        },
        null,
        2
      ),
    },
  ], { maxCompletionTokens: 2048, attempts: 4 });

  const adjudication = {
    ...groqResult.json,
    backend_amount_summary: amount_summary,
    retrieved_rag_topics: topics,
    adjudication_mode: adjudicationMode,
    backend_evidence_review: evidenceReview,
  };

  const evidenceCheckedAdjudication = applyEvidenceReview(adjudication, evidenceReview);

  return applyPolicyGuard(evidenceCheckedAdjudication, { precheck, extraction, claimInput });
}

module.exports = {
  runAiAdjudication,
};
