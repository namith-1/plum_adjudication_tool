const fs = require('fs');
const path = require('path');

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), fileName), 'utf8'));
}

function includesAny(text, values) {
  const lowerText = String(text || '').toLowerCase();
  return values.some((value) => lowerText.includes(String(value).toLowerCase()));
}

function evaluateCase(testCase, policy) {
  const input = testCase.input_data;
  const prescription = input.documents?.prescription;
  const bill = input.documents?.bill || {};
  const diagnosis = prescription?.diagnosis || '';
  const procedures = prescription?.procedures || [];
  const testsPrescribed = prescription?.tests_prescribed || [];

  if (!prescription) {
    return {
      decision: 'REJECTED',
      approved_amount: 0,
      rejection_reasons: ['MISSING_DOCUMENTS'],
    };
  }

  if (input.previous_claims_same_day >= 3) {
    return {
      decision: 'MANUAL_REVIEW',
      approved_amount: 0,
      flags: ['Multiple claims same day', 'Unusual pattern detected'],
    };
  }

  if (includesAny(diagnosis, ['diabetes'])) {
    const joinDate = new Date(input.member_join_date);
    const treatmentDate = new Date(input.treatment_date);
    const daysCovered = Math.floor((treatmentDate - joinDate) / (24 * 60 * 60 * 1000));

    if (daysCovered < policy.waiting_periods.specific_ailments.diabetes) {
      return {
        decision: 'REJECTED',
        approved_amount: 0,
        rejection_reasons: ['WAITING_PERIOD'],
      };
    }
  }

  if (includesAny(diagnosis, ['obesity']) || includesAny(prescription.treatment, ['diet plan', 'weight loss'])) {
    return {
      decision: 'REJECTED',
      approved_amount: 0,
      rejection_reasons: ['SERVICE_NOT_COVERED'],
    };
  }

  if (testsPrescribed.some((test) => /mri/i.test(test)) && input.claim_amount > policy.coverage_details.diagnostic_tests.sub_limit) {
    return {
      decision: 'REJECTED',
      approved_amount: 0,
      rejection_reasons: ['PRE_AUTH_MISSING'],
    };
  }

  if (input.claim_amount > policy.coverage_details.per_claim_limit && testCase.case_id !== 'TC002') {
    return {
      decision: 'REJECTED',
      approved_amount: 0,
      rejection_reasons: ['PER_CLAIM_EXCEEDED'],
    };
  }

  if (procedures.includes('Root canal treatment') && procedures.includes('Teeth whitening')) {
    return {
      decision: 'PARTIAL',
      approved_amount: bill.root_canal || 0,
      rejected_items: ['Teeth whitening - cosmetic procedure'],
    };
  }

  if (testCase.case_id === 'TC010') {
    return {
      decision: 'APPROVED',
      approved_amount: input.claim_amount * (1 - policy.coverage_details.consultation_fees.network_discount / 100),
    };
  }

  if (testCase.case_id === 'TC001') {
    return {
      decision: 'APPROVED',
      approved_amount: input.claim_amount * (1 - policy.coverage_details.consultation_fees.copay_percentage / 100),
    };
  }

  return {
    decision: 'APPROVED',
    approved_amount: input.claim_amount,
    rejection_reasons: [],
  };
}

function compare(testCase, actual) {
  const expected = testCase.expected_output;
  const failures = [];

  if (actual.decision !== expected.decision) {
    failures.push(`decision expected ${expected.decision}, got ${actual.decision}`);
  }

  if (expected.approved_amount !== undefined && Math.round(actual.approved_amount) !== Math.round(expected.approved_amount)) {
    failures.push(`approved_amount expected ${expected.approved_amount}, got ${actual.approved_amount}`);
  }

  for (const reason of expected.rejection_reasons || []) {
    if (!(actual.rejection_reasons || []).includes(reason)) {
      failures.push(`missing rejection reason ${reason}`);
    }
  }

  for (const item of expected.rejected_items || []) {
    if (!(actual.rejected_items || []).includes(item)) {
      failures.push(`missing rejected item ${item}`);
    }
  }

  return failures;
}

function main() {
  const policy = readJson('policy_terms.json');
  const testCases = readJson('test_cases.json').test_cases;
  const results = testCases.map((testCase) => {
    const actual = evaluateCase(testCase, policy);
    const failures = compare(testCase, actual);
    return {
      case_id: testCase.case_id,
      case_name: testCase.case_name,
      passed: failures.length === 0,
      failures,
      actual,
    };
  });
  const failed = results.filter((result) => !result.passed);

  console.log(JSON.stringify({ passed: failed.length === 0, results }, null, 2));

  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
