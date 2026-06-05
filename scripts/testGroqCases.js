require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { submitExtractedJsonForAdjudication } = require('../src/services/claimSubmissionService');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), fileName), 'utf8'));
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readArg(name, fallback) {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) {
    return equalsArg.split('=').slice(1).join('=');
  }

  const argIndex = process.argv.indexOf(name);
  if (argIndex !== -1 && process.argv[argIndex + 1] && !process.argv[argIndex + 1].startsWith('--')) {
    return process.argv[argIndex + 1];
  }

  return fallback;
}

function buildPrescription(input) {
  const prescription = input.documents?.prescription;

  if (!prescription) {
    return [];
  }

  return [
    {
      data_quality: {
        overall_confidence_score: 0.95,
        blur_level: 'none',
        is_cropped_or_cut_off: false,
        field_issues: [],
      },
      clinic_info: {
        name: 'Test Clinic',
        address: null,
        phone: null,
      },
      doctor_info: {
        name: prescription.doctor_name || null,
        qualification: null,
        registration_number: prescription.doctor_reg || null,
        state_code: prescription.doctor_reg?.split('/')?.[0] || null,
      },
      patient_info: {
        name: input.member_name,
        age: null,
        gender: null,
        address: null,
      },
      clinical_details: {
        date: input.treatment_date,
        chief_complaints: [],
        diagnosis: toArray(prescription.diagnosis),
        vitals: {
          bp: null,
          temperature: null,
          weight: null,
        },
      },
      prescribed_medicines: toArray(prescription.medicines_prescribed).map((medicine) => ({
        name: medicine,
        strength: null,
        dosage_pattern: null,
        duration: null,
        additional_instructions: null,
      })),
      investigations_advised: toArray(prescription.tests_prescribed),
      procedures_advised: toArray(prescription.procedures || prescription.treatment),
      follow_up_date: null,
      signatures_and_stamps_detected: true,
      unmapped_data: {
        structured_extras: {
          treatment: prescription.treatment || null,
          procedures: prescription.procedures || [],
        },
        raw_leftover_text: '',
        raw_full_visible_text: JSON.stringify(prescription),
        unmapped_visual_observations: [],
      },
    },
  ];
}

function billLineItems(bill) {
  return Object.entries(bill || {})
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => ({
      category:
        key.includes('medicine') || key.includes('pharmacy')
          ? 'Medicine'
          : key.includes('test') || key.includes('mri') || key.includes('scan')
            ? 'Diagnostic'
            : key.includes('consult')
              ? 'Consultation'
              : key.includes('canal') || key.includes('therapy') || key.includes('whitening')
                ? 'Procedure'
                : 'Other',
      description: key.replaceAll('_', ' '),
      amount: value,
    }));
}

function buildMedicalBills(input) {
  const bill = input.documents?.bill;

  if (!bill) {
    return [];
  }

  const lineItems = billLineItems(bill);
  const total = lineItems.reduce((sum, item) => sum + item.amount, 0);

  return [
    {
      data_quality: {
        overall_confidence_score: 0.95,
        blur_level: 'none',
        is_cropped_or_cut_off: false,
        field_issues: [],
      },
      hospital_info: {
        name: input.hospital || 'Test Hospital',
        address: null,
        gst_number: 'TEST-GST',
      },
      bill_details: {
        bill_number: `BILL-${input.member_id}`,
        date: input.treatment_date,
        referring_doctor: input.documents?.prescription?.doctor_name || null,
      },
      patient_info: {
        name: input.member_name,
        contact: null,
      },
      line_items: lineItems,
      financials: {
        sub_total: total,
        taxes: 0,
        total_amount: total,
        amount_in_words: null,
        payment_mode: null,
        transaction_id: null,
      },
      signatures_and_stamps_detected: true,
      unmapped_data: {
        structured_extras: {
          test_names: bill.test_names || [],
        },
        raw_leftover_text: '',
        raw_full_visible_text: JSON.stringify(bill),
        unmapped_visual_observations: [],
      },
    },
  ];
}

function buildExtraction(input) {
  const prescriptions = buildPrescription(input);
  const medicalBills = buildMedicalBills(input);

  return {
    claim_extraction: {
      summary: {
        overall_treatment_date_range: {
          start_date: input.treatment_date,
          end_date: input.treatment_date,
        },
        consistent_patient_name: input.member_name,
        consistent_doctor_names: prescriptions.map((doc) => doc.doctor_info.name).filter(Boolean),
        all_diagnoses: prescriptions.flatMap((doc) => doc.clinical_details.diagnosis || []),
      },
      documents: {
        prescriptions,
        medical_bills: medicalBills,
        diagnostic_reports: [],
        pharmacy_bills: [],
      },
    },
  };
}

function compareResult(testCase, result) {
  const expected = testCase.expected_output;
  const actual = result.adjudication || result.precheck || {};
  const failures = [];

  if (actual.decision !== expected.decision) {
    failures.push(`decision expected ${expected.decision}, got ${actual.decision}`);
  }

  for (const reason of expected.rejection_reasons || []) {
    if (!toArray(actual.rejection_reasons).includes(reason)) {
      failures.push(`missing rejection reason ${reason}`);
    }
  }

  for (const item of expected.rejected_items || []) {
    const rejectedText = JSON.stringify(actual.rejected_items || actual.non_claimable_procedures || []);
    if (!rejectedText.includes(item.split(' - ')[0])) {
      failures.push(`missing rejected item ${item}`);
    }
  }

  return {
    case_id: testCase.case_id,
    case_name: testCase.case_name,
    passed: failures.length === 0,
    failures,
    expected_decision: expected.decision,
    actual_decision: actual.decision,
    actual_rejection_reasons: actual.rejection_reasons || [],
    actual_flags: actual.flags || [],
    groq_called: result.stage === 'DIRECT_JSON_ADJUDICATION',
  };
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const caseFilter = readArg('--case', process.env.CASE_ID);
  const delayMs = Number(readArg('--delay-ms', process.env.GROQ_TEST_DELAY_MS || 12000));
  const testCases = readJson('test_cases.json').test_cases.filter((testCase) => !caseFilter || testCase.case_id === caseFilter);

  if (testCases.length === 0) {
    throw new Error(`No test cases matched ${caseFilter}`);
  }

  const results = [];

  for (let index = 0; index < testCases.length; index += 1) {
    const testCase = testCases[index];
    const input = testCase.input_data;

    console.error(`Running ${testCase.case_id} through Groq (${index + 1}/${testCases.length})...`);

    let compared;
    try {
      const result = await submitExtractedJsonForAdjudication({
        member_id: input.member_id,
        member_name: input.member_name,
        claim_amount: input.claim_amount,
        submission_date: input.treatment_date,
        previous_claims_same_day: input.previous_claims_same_day,
        adjudication_mode: 'normal',
        ignore_duplicate_claims: true,
        extraction: buildExtraction(input),
        update_db: false,
      });
      compared = compareResult(testCase, result);
    } catch (error) {
      compared = {
        case_id: testCase.case_id,
        case_name: testCase.case_name,
        passed: false,
        failures: [error.message],
        expected_decision: testCase.expected_output?.decision,
        actual_decision: 'ERROR',
        actual_rejection_reasons: [],
        actual_flags: [],
        groq_called: true,
      };
    }

    results.push(compared);
    console.log(JSON.stringify(compared, null, 2));

    if (index < testCases.length - 1) {
      await sleep(delayMs);
    }
  }

  await mongoose.disconnect();

  const passedCount = results.filter((result) => result.passed).length;
  const groqCalledCount = results.filter((result) => result.groq_called).length;

  console.log(
    JSON.stringify(
      {
        passed: passedCount === results.length,
        passed_count: passedCount,
        total_count: results.length,
        groq_called_count: groqCalledCount,
        note: 'expected_output was not sent to Groq; comparison happened locally after results returned.',
        results,
      },
      null,
      2
    )
  );

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
