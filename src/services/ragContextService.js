function pickPolicyContext(policy, topics) {
  const coverage = policy.coverage_details || {};
  const topicSet = new Set(topics);
  const context = {
    policy_id: policy.policy_id,
    policy_name: policy.policy_name,
    effective_date: policy.effective_date,
    waiting_periods: policy.waiting_periods,
    exclusions: policy.exclusions,
    claim_requirements: policy.claim_requirements,
    selected_coverage: {
      annual_limit: coverage.annual_limit,
      per_claim_limit: coverage.per_claim_limit,
      family_floater_limit: coverage.family_floater_limit,
    },
  };

  for (const key of ['consultation_fees', 'pharmacy', 'diagnostic_tests', 'dental', 'vision', 'alternative_medicine']) {
    const topicName = key === 'consultation_fees' ? 'consultation' : key;

    if (
      key === 'consultation_fees' ||
      topicSet.has(topicName) ||
      (key === 'diagnostic_tests' && topicSet.has('diagnostic'))
    ) {
      context.selected_coverage[key] = coverage[key];
    }
  }

  return context;
}

function getRuleChunks(topics) {
  const topicSet = new Set(topics);
  const chunks = [
    {
      id: 'eligibility',
      text: 'Policy must be active on treatment date. Waiting period must be satisfied. Claimant must be covered member or dependent.',
    },
    {
      id: 'documents',
      text: 'Required documents must be present and readable. Patient details should match records. Doctor registration/provider identity and bill details are important.',
    },
    {
      id: 'limits',
      text: 'Apply annual limit, per-claim limit, sub-limits, copay, and network discount. Amount mismatch alone should not reject; approve eligible calculated/capped amount with remark.',
    },
    {
      id: 'duplicates',
      text: 'Reject DUPLICATE_CLAIM if same treatment date or same medical episode was already claimed, unless replacing a rejected unusable-document claim.',
    },
  ];

  if (topicSet.has('pharmacy')) {
    chunks.push({
      id: 'pharmacy',
      text: 'Pharmacy bills require prescription support for claimed medicines. Unsupported medicines are rejected item-wise. Apply pharmacy sub-limit and branded/generic rules.',
    });
  }

  if (topicSet.has('diagnostic')) {
    chunks.push({
      id: 'diagnostic',
      text: 'Diagnostic bills require investigation advice in prescription or supporting diagnostic report/referral. MRI/CT may require pre-authorization depending on policy.',
    });
  }

  if (topicSet.has('dental')) {
    chunks.push({
      id: 'dental',
      text: 'Dental covered procedures may include filling, extraction, root canal, cleaning. Cosmetic procedures like whitening should be rejected.',
    });
  }

  if (topicSet.has('vision')) {
    chunks.push({
      id: 'vision',
      text: 'Vision claims depend on policy coverage for eye tests, glasses/contact lenses, and exclusions like LASIK.',
    });
  }

  if (topicSet.has('alternative_medicine')) {
    chunks.push({
      id: 'alternative_medicine',
      text: 'Alternative medicine is claimable only for listed treatments such as Ayurveda, Homeopathy, or Unani and within therapy/session limits.',
    });
  }

  if (topicSet.has('exclusions')) {
    chunks.push({
      id: 'exclusions',
      text: 'Policy exclusions override other coverage. Common exclusions include cosmetic procedures, weight loss treatments, infertility, experimental treatments, and non-listed treatments.',
    });
  }

  if (topicSet.has('procedures')) {
    chunks.push({
      id: 'procedures',
      text: 'Procedure bills require medical support from prescription, diagnosis, investigation advice, report, or treatment notes. Reject unsupported procedures item-wise.',
    });
  }

  if (topicSet.has('authenticity')) {
    chunks.push({
      id: 'authenticity',
      text: 'Check doctor registration, provider identity, stamps/signatures, and suspicious alterations. If uncertain or fraud indicators exist, send to MANUAL_REVIEW.',
    });
  }

  return chunks;
}

function buildRagContext({ policy, topics }) {
  return {
    retrieved_topics: topics,
    policy_context: pickPolicyContext(policy, topics),
    rule_chunks: getRuleChunks(topics),
  };
}

module.exports = {
  buildRagContext,
};
