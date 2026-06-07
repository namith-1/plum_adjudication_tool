const CLAIM_ADJUDICATION_PROMPT = require('../prompts/claimAdjudicationPrompt');
const { callGroqJsonWithRetry } = require('./groqClient');
const { UserPolicyClaims } = require('../models');
const { summarizeExtraction, detectClaimTopics } = require('./claimSummaryService');
const { buildRagContext } = require('./ragContextService');
const { reviewClaimEvidence, applyEvidenceReview } = require('./claimEvidenceReviewService');
const { applyPolicyGuard } = require('./claimPolicyGuardService');

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

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

function getLineAmount(item) {
  return toNumber(item.amount || item.total_amount || item.net_amount || item.net_payable);
}

function getDocumentName(document, fallback) {
  return (
    document.bill_details?.bill_number ||
    document.report_details?.report_id ||
    document.pharmacy_info?.name ||
    document.hospital_info?.name ||
    document.lab_info?.name ||
    document.clinic_info?.name ||
    fallback
  );
}

function classifyLineItem(item) {
  const text = [
    item.category,
    item.description,
    item.medicine_name,
    item.test_name,
    item.procedure_or_service,
    item.item,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    text.includes('medicine') ||
    text.includes('tablet') ||
    text.includes('capsule') ||
    text.includes('syrup') ||
    text.includes('injection') ||
    text.includes('drug') ||
    text.includes('pharma') ||
    text.includes('mg')
  ) {
    return 'pharmacy_bill';
  }

  if (
    text.includes('diagnostic') ||
    text.includes('test') ||
    text.includes('lab') ||
    text.includes('blood') ||
    text.includes('cbc') ||
    text.includes('mri') ||
    text.includes('ct') ||
    text.includes('x-ray') ||
    text.includes('xray') ||
    text.includes('scan') ||
    text.includes('ultrasound')
  ) {
    return 'diagnostic_report';
  }

  if (
    text.includes('procedure') ||
    text.includes('surgery') ||
    text.includes('therapy') ||
    text.includes('dressing') ||
    text.includes('root canal') ||
    text.includes('administration')
  ) {
    return 'procedure';
  }

  return 'medical_bill';
}

function emptyAmountBreakdown() {
  return {
    prescription: { total: 0, documents: [] },
    medical_bill: { total: 0, documents: [] },
    pharmacy_bill: { total: 0, documents: [] },
    diagnostic_report: { total: 0, documents: [] },
    procedure: { total: 0, documents: [] },
    other: { total: 0, documents: [] },
  };
}

function pushBreakdownDocument(breakdown, bucket, document) {
  breakdown[bucket].documents.push(document);
  breakdown[bucket].total += toNumber(document.amount);
}

function itemName(item) {
  return item.description || item.medicine_name || item.test_name || item.procedure_or_service || item.item || 'Item';
}

function buildDocumentAmountBreakdown(extraction) {
  const documents = extraction?.claim_extraction?.documents || {};
  const breakdown = emptyAmountBreakdown();

  safeArray(documents.prescriptions).forEach((document, index) => {
    pushBreakdownDocument(breakdown, 'prescription', {
      name: getDocumentName(document, `Prescription ${index + 1}`),
      amount: 0,
      items: [
        ...safeArray(document.prescribed_medicines).map((item) => ({ name: item.name || 'Medicine advised', amount: 0 })),
        ...safeArray(document.investigations_advised).map((name) => ({ name, amount: 0 })),
      ],
    });
  });

  safeArray(documents.medical_bills).forEach((document, index) => {
    const grouped = {};
    safeArray(document.line_items).forEach((item) => {
      const bucket = classifyLineItem(item);
      grouped[bucket] = grouped[bucket] || [];
      grouped[bucket].push({ name: itemName(item), amount: getLineAmount(item) });
    });

    if (Object.keys(grouped).length === 0) {
      pushBreakdownDocument(breakdown, 'medical_bill', {
        name: getDocumentName(document, `Medical Bill ${index + 1}`),
        amount: toNumber(document.financials?.total_amount),
        items: [],
      });
      return;
    }

    Object.entries(grouped).forEach(([bucket, items]) => {
      const amount = items.reduce((total, item) => total + toNumber(item.amount), 0);
      pushBreakdownDocument(breakdown, bucket, {
        name: getDocumentName(document, `Medical Bill ${index + 1}`),
        amount,
        items,
      });
    });
  });

  safeArray(documents.pharmacy_bills).forEach((document, index) => {
    const items = safeArray(document.line_items).map((item) => ({
      name: itemName(item),
      amount: getLineAmount(item),
    }));
    const amount =
      toNumber(document.financials?.net_payable || document.financials?.total_amount) ||
      items.reduce((total, item) => total + toNumber(item.amount), 0);
    pushBreakdownDocument(breakdown, 'pharmacy_bill', {
      name: getDocumentName(document, `Pharmacy Bill ${index + 1}`),
      amount,
      items,
    });
  });

  safeArray(documents.diagnostic_reports).forEach((document, index) => {
    const items = safeArray(document.test_results).map((item) => ({
      name: item.test_name || item.panel_name || 'Diagnostic test',
      amount: getLineAmount(item),
    }));
    const amount = items.reduce((total, item) => total + toNumber(item.amount), 0);
    pushBreakdownDocument(breakdown, 'diagnostic_report', {
      name: getDocumentName(document, `Diagnostic Report ${index + 1}`),
      amount,
      items,
    });
  });

  Object.values(breakdown).forEach((bucket) => {
    bucket.total = Number(bucket.total.toFixed(2));
  });

  return breakdown;
}

function summarizeExtractedAmounts(extraction, requestedClaimAmount) {
  const documentAmountBreakdown = buildDocumentAmountBreakdown(extraction);
  const medicalBillTotal = documentAmountBreakdown.medical_bill.total;
  const pharmacyBillTotal = documentAmountBreakdown.pharmacy_bill.total;
  const categorizedTotal = Object.entries(documentAmountBreakdown)
    .filter(([key]) => key !== 'prescription')
    .reduce((total, [, bucket]) => total + toNumber(bucket.total), 0);
  const totalExtractedBillAmount = categorizedTotal;
  const requestedAmount = toNumber(requestedClaimAmount);

  return {
    claimed_amount_from_request: requestedAmount,
    claim_amount_is_display_only: true,
    medical_bill_total: medicalBillTotal,
    pharmacy_bill_total: pharmacyBillTotal,
    diagnostic_bill_total: documentAmountBreakdown.diagnostic_report.total,
    procedure_total: documentAmountBreakdown.procedure.total,
    total_extracted_bill_amount: totalExtractedBillAmount,
    difference_from_requested: totalExtractedBillAmount - requestedAmount,
    amount_matches_request: requestedAmount === 0 ? null : Math.abs(totalExtractedBillAmount - requestedAmount) <= 1,
    document_amount_breakdown: documentAmountBreakdown,
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
  const detectedTopics = detectClaimTopics(claimSummary);
  const topics =
    adjudicationMode === 'normal'
      ? detectedTopics.filter((topic) => topic !== 'authenticity')
      : detectedTopics;
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
  ], { maxCompletionTokens: Number(process.env.AI_ADJUDICATION_MAX_OUTPUT_TOKENS || 12000), attempts: 4 });

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
