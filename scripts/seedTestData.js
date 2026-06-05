require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { PolicyData, UserData, UserPolicy } = require('../src/models');

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), fileName), 'utf8'));
}

function mapPolicyTerms(policyTerms) {
  return {
    policy_id: policyTerms.policy_id,
    policy_name: policyTerms.policy_name,
    company_name: policyTerms.policy_holder.company,
    effective_date: new Date(policyTerms.effective_date),
    coverage_details: policyTerms.coverage_details,
    waiting_periods: {
      initial_waiting_days: policyTerms.waiting_periods.initial_waiting,
      pre_existing_diseases_days: policyTerms.waiting_periods.pre_existing_diseases,
      maternity_days: policyTerms.waiting_periods.maternity,
      specific_ailments: policyTerms.waiting_periods.specific_ailments,
    },
    exclusions: policyTerms.exclusions,
    claim_requirements: policyTerms.claim_requirements,
    network_hospitals: policyTerms.network_hospitals,
    cashless_facilities: policyTerms.cashless_facilities,
  };
}

function conditionsForTestCase(testCase) {
  const diagnosis = testCase.input_data?.documents?.prescription?.diagnosis || '';

  if (/diabetes/i.test(diagnosis)) {
    return ['diabetes'];
  }

  if (/hypertension/i.test(diagnosis)) {
    return ['hypertension'];
  }

  return [];
}

async function seed() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);

  const policyTerms = readJson('policy_terms.json');
  const testCases = readJson('test_cases.json').test_cases;
  const policyData = mapPolicyTerms(policyTerms);
  const policy = await PolicyData.findOneAndUpdate(
    { policy_id: policyData.policy_id },
    { $set: policyData },
    { upsert: true, new: true, runValidators: true }
  );

  let usersUpserted = 0;
  let linksUpserted = 0;

  for (const testCase of testCases) {
    const input = testCase.input_data;
    const joinDate = new Date(input.member_join_date || policyTerms.effective_date);
    const member = await UserData.findOneAndUpdate(
      { member_id: input.member_id },
      {
        $set: {
          member_id: input.member_id,
          member_name: input.member_name,
          company_name: policyTerms.policy_holder.company,
          join_date: joinDate,
          member_type: 'Employee',
          medical_history: {
            pre_existing_conditions: conditionsForTestCase(testCase),
            notes: `Seeded from ${testCase.case_id}: ${testCase.case_name}`,
          },
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    usersUpserted += 1;

    await UserPolicy.findOneAndUpdate(
      { user_id: member._id, policy_id: policy._id },
      {
        $set: {
          user_id: member._id,
          policy_id: policy._id,
          enrollment_date: joinDate,
          status: 'Active',
        },
        $setOnInsert: {
          utilization: {
            total_claimed_amount_ytd: 0,
            consultation_utilized: 0,
            diagnostic_utilized: 0,
            pharmacy_utilized: 0,
          },
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    linksUpserted += 1;
  }

  console.log(
    JSON.stringify(
      {
        policy_id: policy.policy_id,
        users_upserted: usersUpserted,
        user_policy_links_upserted: linksUpserted,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
