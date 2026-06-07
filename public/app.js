const form = document.getElementById('uploadForm');
const documentsInput = document.getElementById('documents');
const instructionsInput = document.getElementById('instructions');
const memberIdInput = document.getElementById('memberId');
const memberNameInput = document.getElementById('memberName');
const claimAmountInput = document.getElementById('claimAmount');
const submissionDateInput = document.getElementById('submissionDate');
const adjudicationModeInput = document.getElementById('adjudicationMode');
const previousConditionsInput = document.getElementById('previousConditions');
const updateDbOnManualReviewInput = document.getElementById('updateDbOnManualReview');
const submitButton = document.getElementById('submitButton');
const clearButton = document.getElementById('clearButton');
const copyButton = document.getElementById('copyButton');
const downloadButton = document.getElementById('downloadButton');
const downloadSummaryButton = document.getElementById('downloadSummaryButton');
const saveManualReviewButton = document.getElementById('saveManualReviewButton');
const fileList = document.getElementById('fileList');
const output = document.getElementById('output');
const resultView = document.getElementById('resultView');
const statusBadge = document.getElementById('statusBadge');
const adminStatusBadge = document.getElementById('adminStatusBadge');
const adminOutput = document.getElementById('adminOutput');
const userForm = document.getElementById('userForm');
const policyForm = document.getElementById('policyForm');
const linkPolicyForm = document.getElementById('linkPolicyForm');
const refreshAdminButton = document.getElementById('refreshAdminButton');
const memberTypeInput = document.getElementById('memberType');
const primaryMemberField = document.getElementById('primaryMemberField');
const primaryMemberSelect = document.getElementById('primaryMemberSelect');
const linkUserSelect = document.getElementById('linkUserSelect');
const linkPolicySelect = document.getElementById('linkPolicySelect');
let latestResult = null;
let adminUsers = [];
let adminPolicies = [];

function setStatus(text, state = '') {
  statusBadge.textContent = text;
  statusBadge.className = `badge ${state}`.trim();
}

function setAdminStatus(text, state = '') {
  adminStatusBadge.textContent = text;
  adminStatusBadge.className = `badge ${state}`.trim();
}

function renderAdminJson(value) {
  adminOutput.textContent = JSON.stringify(value, null, 2);
}

function formToJson(targetForm) {
  const payload = {};
  const data = new FormData(targetForm);

  for (const [key, value] of data.entries()) {
    payload[key] = typeof value === 'string' ? value.trim() : value;
  }

  targetForm.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    payload[input.name] = input.checked;
  });

  return payload;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFiles() {
  const files = Array.from(documentsInput.files || []);

  if (files.length === 0) {
    fileList.textContent = 'No files selected.';
    return;
  }

  fileList.innerHTML = files
    .map(
      (file) => `
        <div class="file-item">
          <span class="file-name">${file.name}</span>
          <span>${formatBytes(file.size)}</span>
        </div>
      `
    )
    .join('');
}

function renderJson(value) {
  latestResult = value;
  output.textContent = JSON.stringify(value, null, 2);
  renderResultView(value);
  updateManualReviewButton();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function optionHtml(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function formatMoney(value) {
  const number = Number(value || 0);
  return `₹${number.toLocaleString('en-IN')}`;
}

function getFinalDecision(result) {
  return result?.adjudication?.decision || result?.precheck?.decision || result?.status || 'PENDING';
}

function getResultSummary(result) {
  const adjudication = result?.adjudication || {};
  const precheck = result?.precheck || {};
  const source = adjudication.decision ? adjudication : precheck;

  return {
    claim_id: result?.claim_id || source.claim_id || 'CLM_XXXXX',
    decision: getFinalDecision(result),
    approved_amount: Number(adjudication.approved_amount || 0),
    rejection_reasons: source.rejection_reasons || [],
    confidence_score:
      typeof source.confidence_score === 'number'
        ? source.confidence_score
        : source.decision === 'PRELIMINARY_ELIGIBILITY_PASSED'
          ? 1
          : 0,
    notes: source.notes || adjudication.amount_consistency?.amount_remark || 'Additional observations',
    next_steps: source.next_steps || (source.decision === 'APPROVED' ? 'Claim approved. No further action required.' : ''),
  };
}

function downloadJsonFile(fileName, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function decisionClass(decision) {
  if (decision === 'APPROVED') return 'good';
  if (decision === 'PARTIAL' || decision === 'MANUAL_REVIEW') return 'warn';
  if (decision === 'REJECTED' || decision === 'REQUEST_CLEAR_IMAGE' || decision === 'REQUEST_MORE_INFO') return 'bad';
  return 'neutral';
}

function listItems(items, emptyText = 'None') {
  if (!items || items.length === 0) {
    return `<p class="muted">${emptyText}</p>`;
  }

  return `<ul class="compact-list">${items
    .map((item) => `<li>${escapeHtml(typeof item === 'string' ? item : JSON.stringify(item))}</li>`)
    .join('')}</ul>`;
}

function renderKeyValues(values) {
  return `<div class="kv-grid">${values
    .map(
      ([label, value]) => `
        <div class="kv">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `
    )
    .join('')}</div>`;
}

function compactValue(value) {
  if (value === undefined || value === null || value === '') return 'Not found';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Not found';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function documentLabel(type, index) {
  return `${type.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())} ${index + 1}`;
}

function getDocumentIdentityRows(extraction = {}) {
  const documents = extraction.claim_extraction?.documents || extraction.documents || {};
  const configs = [
    {
      key: 'prescriptions',
      providerLabel: 'Clinic',
      provider: (doc) => doc.clinic_info?.name,
      date: (doc) => doc.clinical_details?.date,
    },
    {
      key: 'medical_bills',
      providerLabel: 'Hospital',
      provider: (doc) => doc.hospital_info?.name,
      date: (doc) => doc.bill_details?.date,
    },
    {
      key: 'diagnostic_reports',
      providerLabel: 'Lab',
      provider: (doc) => doc.lab_info?.name,
      date: (doc) => doc.report_details?.date,
    },
    {
      key: 'pharmacy_bills',
      providerLabel: 'Pharmacy',
      provider: (doc) => doc.pharmacy_info?.name,
      date: (doc) => doc.bill_details?.date,
    },
  ];

  return configs.flatMap((config) =>
    (documents[config.key] || []).map((doc, index) => ({
      title: documentLabel(config.key, index),
      patient: doc.patient_info || {},
      providerLabel: config.providerLabel,
      provider: config.provider(doc),
      date: config.date(doc),
      confidence: doc.data_quality?.overall_confidence_score,
    }))
  );
}

function renderIdentityPanels(result) {
  const member = result?.precheck?.member;
  const documentRows = getDocumentIdentityRows(result?.extraction);

  if (!member && documentRows.length === 0) {
    return '';
  }

  const dbCard = member
    ? `
      <article class="identity-card db-record">
        <div class="identity-card-title">
          <strong>Record Found User Data</strong>
          <span>MongoDB</span>
        </div>
        ${renderKeyValues([
          ['Member ID', compactValue(member.member_id)],
          ['Name', compactValue(member.member_name)],
          ['DOB', compactValue(member.date_of_birth)],
          ['Age', compactValue(member.age_at_treatment)],
          ['Gender', compactValue(member.gender)],
          ['Type', compactValue(member.member_type)],
        ])}
      </article>
    `
    : '<p class="muted">No DB member record returned.</p>';

  const documentCards = documentRows.length
    ? documentRows
        .map(
          (row) => `
            <article class="identity-card">
              <div class="identity-card-title">
                <strong>${escapeHtml(row.title)}</strong>
                <span>${escapeHtml(row.confidence === undefined ? 'Confidence N/A' : `Confidence ${row.confidence}`)}</span>
              </div>
              ${renderKeyValues([
                ['Name', compactValue(row.patient.name)],
                ['DOB', compactValue(row.patient.date_of_birth)],
                ['Age', compactValue(row.patient.age)],
                ['Gender', compactValue(row.patient.gender)],
                ['Date', compactValue(row.date)],
                [row.providerLabel, compactValue(row.provider)],
              ])}
            </article>
          `
        )
        .join('')
    : '<p class="muted">No document patient data extracted.</p>';

  return `
    <section class="result-section">
      <h3>Patient Identity</h3>
      <div class="identity-grid">
        ${dbCard}
        ${documentCards}
      </div>
    </section>
  `;
}

function humanLabel(value) {
  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function primitiveDisplay(value) {
  if (value === null) return 'null';
  if (value === undefined || value === '') return 'Not found';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function renderHumanJson(value, label = 'Result', depth = 0) {
  if (value === null || typeof value !== 'object') {
    return `
      <div class="detail-row">
        <span>${escapeHtml(humanLabel(label))}</span>
        <strong>${escapeHtml(primitiveDisplay(value))}</strong>
      </div>
    `;
  }

  if (Array.isArray(value)) {
    return `
      <details class="detail-group depth-${Math.min(depth, 3)}" open>
        <summary>
          <span>${escapeHtml(humanLabel(label))}</span>
          <em>${value.length} item${value.length === 1 ? '' : 's'}</em>
        </summary>
        <div class="detail-body">
          ${
            value.length
              ? value
                  .map(
                    (item, index) => `
                      <article class="detail-item">
                        ${renderHumanJson(item, `${humanLabel(label)} ${index + 1}`, depth + 1)}
                      </article>
                    `
                  )
                  .join('')
              : '<p class="muted">Empty list</p>'
          }
        </div>
      </details>
    `;
  }

  const entries = Object.entries(value);
  const primitiveEntries = entries.filter(([, item]) => item === null || typeof item !== 'object');
  const nestedEntries = entries.filter(([, item]) => item !== null && typeof item === 'object');

  return `
    <details class="detail-group depth-${Math.min(depth, 3)}" open>
      <summary>
        <span>${escapeHtml(humanLabel(label))}</span>
        <em>${entries.length} field${entries.length === 1 ? '' : 's'}</em>
      </summary>
      <div class="detail-body">
        ${
          primitiveEntries.length
            ? `<div class="detail-rows">${primitiveEntries.map(([key, item]) => renderHumanJson(item, key, depth + 1)).join('')}</div>`
            : ''
        }
        ${nestedEntries.map(([key, item]) => renderHumanJson(item, key, depth + 1)).join('')}
        ${entries.length ? '' : '<p class="muted">Empty object</p>'}
      </div>
    </details>
  `;
}

function renderCompleteJsonOutput(result) {
  return `
    <section class="result-section full-details-section">
      <h3>Full Result Details</h3>
      <p class="section-note">Every field from the API response is shown below in readable sections.</p>
      <div class="detail-explorer">
        ${renderHumanJson(result, 'API Response')}
      </div>
    </section>
  `;
}

function renderCheckCards(checks = {}) {
  const entries = Object.entries(checks);

  if (entries.length === 0) {
    return '<p class="muted">No check details returned.</p>';
  }

  return `<div class="check-grid">${entries
    .map(([name, check]) => {
      const status = check.status || (check.passed === true ? 'passed' : check.passed === false ? 'failed' : 'unknown');
      const cls = status === 'passed' ? 'good' : status === 'failed' ? 'bad' : status === 'not_applicable' ? 'neutral' : 'warn';
      return `
        <article class="check-card ${cls}">
          <div class="check-title">
            <strong>${escapeHtml(name.replaceAll('_', ' '))}</strong>
            <span>${escapeHtml(status)}</span>
          </div>
          <p>${escapeHtml(check.reason || check.notes || 'No reason provided')}</p>
          ${check.failure_code ? `<small>Code: ${escapeHtml(check.failure_code)}</small>` : ''}
        </article>
      `;
    })
    .join('')}</div>`;
}

function renderProcedures(title, items = [], className = '') {
  return `
    <section class="result-section">
      <h3>${escapeHtml(title)}</h3>
      ${
        items.length
          ? `<div class="item-table">${items
              .map(
                (item) => `
                  <div class="item-row ${className}">
                    <span>${escapeHtml(item.procedure_or_service || item.item || item.document_type || 'Item')}</span>
                    <span>${formatMoney(item.amount)}</span>
                    <em>${escapeHtml(item.reason || item.rejection_code || item.linked_treatment_or_procedure || '')}</em>
                  </div>
                `
              )
              .join('')}</div>`
          : '<p class="muted">None</p>'
      }
    </section>
  `;
}

function getAmountBreakdown(result) {
  const adjudication = result?.adjudication || {};
  const backendBreakdown = adjudication.backend_amount_summary?.document_amount_breakdown;
  const rawBreakdown = adjudication.document_amount_breakdown || backendBreakdown;
  return rawBreakdown ? normalizeAmountBreakdown(rawBreakdown) : null;
}

function normalizeAmountBreakdown(rawBreakdown = {}) {
  const emptyBucket = () => ({ total: 0, documents: [] });
  const breakdown = {
    prescription: rawBreakdown.prescription || emptyBucket(),
    medical_bill: rawBreakdown.medical_bill || emptyBucket(),
    pharmacy_bill: rawBreakdown.pharmacy_bill || emptyBucket(),
    diagnostic_report: rawBreakdown.diagnostic_report || emptyBucket(),
    procedure: rawBreakdown.procedure || emptyBucket(),
    other: rawBreakdown.other || emptyBucket(),
  };

  if (!rawBreakdown.medical_bill && typeof rawBreakdown.medical_bill_total === 'number') {
    breakdown.medical_bill.total = rawBreakdown.medical_bill_total;
  }
  if (!rawBreakdown.pharmacy_bill && typeof rawBreakdown.pharmacy_bill_total === 'number') {
    breakdown.pharmacy_bill.total = rawBreakdown.pharmacy_bill_total;
  }
  if (!rawBreakdown.diagnostic_report && typeof rawBreakdown.diagnostic_bill_total === 'number') {
    breakdown.diagnostic_report.total = rawBreakdown.diagnostic_bill_total;
  }
  if (!rawBreakdown.procedure && typeof rawBreakdown.procedure_total === 'number') {
    breakdown.procedure.total = rawBreakdown.procedure_total;
  }

  return breakdown;
}

function normalizeDocumentType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('prescription')) return 'prescription';
  if (text.includes('pharmacy')) return 'pharmacy_bill';
  if (text.includes('diagnostic') || text.includes('report') || text.includes('lab')) return 'diagnostic_report';
  if (text.includes('procedure')) return 'procedure';
  if (text.includes('medical') || text.includes('bill')) return 'medical_bill';
  return 'other';
}

function bucketDisplayName(bucketKey) {
  return {
    prescription: 'Prescription',
    medical_bill: 'Medical Bill',
    pharmacy_bill: 'Pharmacy Bill',
    diagnostic_report: 'Diagnostic Report',
    procedure: 'Procedure',
    other: 'Other',
  }[bucketKey] || 'Document';
}

function getClaimableDocumentRows(result) {
  const adjudication = result?.adjudication || {};
  const breakdown = getAmountBreakdown(result);
  const aiDocuments = adjudication.claimable_documents || [];
  const reasonByType = new Map(
    aiDocuments.map((document) => [
      normalizeDocumentType(document.document_type || document.type || document.name),
      document.reason || document.linked_treatment_or_procedure || '',
    ])
  );

  if (!breakdown) {
    return aiDocuments;
  }

  return Object.entries(breakdown).flatMap(([bucketKey, bucket]) => {
    const documents = bucket.documents || [];

    if (documents.length === 0) {
      return [];
    }

    return documents.map((document) => ({
      document_type: `${bucketDisplayName(bucketKey)} - ${document.name || bucketDisplayName(bucketKey)}`,
      amount: document.amount,
      reason: reasonByType.get(bucketKey) || `${bucketDisplayName(bucketKey)} amount extracted from document.`,
      linked_treatment_or_procedure: (document.items || []).map((item) => item.name).filter(Boolean).join(', '),
    }));
  });
}

function renderAmountByDocument(result) {
  const breakdown = getAmountBreakdown(result);

  if (!breakdown) {
    return '';
  }

  const buckets = [
    ['Prescription', breakdown.prescription],
    ['Medical Bill', breakdown.medical_bill],
    ['Pharmacy Bill', breakdown.pharmacy_bill],
    ['Diagnostic Report', breakdown.diagnostic_report],
    ['Procedure', breakdown.procedure],
    ['Other', breakdown.other],
  ];

  return `
    <section class="result-section">
      <h3>Amount By Document</h3>
      <div class="amount-doc-grid">
        ${buckets
          .map(([label, bucket]) => {
            const documents = bucket.documents || [];
            return `
              <article class="amount-doc-card">
                <div class="amount-doc-title">
                  <strong>${escapeHtml(label)}</strong>
                  <span>${formatMoney(bucket.total)}</span>
                </div>
                ${
                  documents.length
                    ? `<div class="amount-doc-list">${documents
                        .map(
                          (document) => `
                            <div class="amount-doc-entry">
                              <div>
                                <strong>${escapeHtml(document.name || label)}</strong>
                                <span>${formatMoney(document.amount)}</span>
                              </div>
                              ${
                                document.items?.length
                                  ? `<ul>${document.items
                                      .map((item) => `<li><span>${escapeHtml(item.name || 'Item')}</span><b>${formatMoney(item.amount)}</b></li>`)
                                      .join('')}</ul>`
                                  : ''
                              }
                            </div>
                          `
                        )
                        .join('')}</div>`
                    : '<p class="muted">No amount found</p>'
                }
              </article>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}

function renderResultView(result) {
  if (!result || Object.keys(result).length === 0) {
    resultView.innerHTML = '<p class="empty-state">Submit a claim to see the adjudication summary.</p>';
    return;
  }

  const adjudication = result.adjudication || {};
  const precheck = result.precheck || {};
  const decision = getFinalDecision(result);
  const amountSummary = adjudication.backend_amount_summary || precheck.claim?.amount_limit_check || {};
  const reasons = adjudication.rejection_reasons || precheck.rejection_reasons || [];
  const flags = adjudication.flags || precheck.flags || [];
  const warnings = precheck.warnings || [];

  resultView.innerHTML = `
    <section class="decision-strip ${decisionClass(decision)}">
      <div>
        <span class="decision-label">Decision</span>
        <strong>${escapeHtml(decision)}</strong>
      </div>
      <div>
        <span class="decision-label">Claim ID</span>
        <strong>${escapeHtml(result.claim_id || 'Not saved')}</strong>
      </div>
      <div>
        <span class="decision-label">DB</span>
        <strong>${result.claim_saved || result.persisted ? 'Saved' : 'Not saved'}</strong>
      </div>
    </section>

    ${renderKeyValues([
      ['Display amount', formatMoney(adjudication.claimed_amount_from_request || amountSummary.claimed_amount_from_request || precheck.claim?.claim_amount)],
      ['Approved', formatMoney(adjudication.approved_amount)],
      ['Calculated', formatMoney(adjudication.calculated_claimable_amount || amountSummary.total_extracted_bill_amount)],
      ['Treatment date', result.inferred_treatment_date?.treatment_date || precheck.claim?.treatment_date || 'Unknown'],
      ['Submission date', precheck.claim?.submission_date || 'Not provided'],
      ['Utilization updated', result.utilization_updated ? 'Yes' : 'No'],
    ])}

    ${renderIdentityPanels(result)}
    ${renderAmountByDocument(result)}

    <section class="result-section">
      <h3>Reasons, Flags, Warnings</h3>
      <div class="reason-columns">
        <div><h4>Rejections</h4>${listItems(reasons)}</div>
        <div><h4>Flags</h4>${listItems(flags)}</div>
        <div><h4>Warnings</h4>${listItems(warnings.map((warning) => warning.code || warning.notes))}</div>
      </div>
      ${adjudication.amount_consistency?.amount_remark ? `<p class="remark">${escapeHtml(adjudication.amount_consistency.amount_remark)}</p>` : ''}
    </section>

    ${renderProcedures('Claimable Items / Procedures', adjudication.claimable_procedures || adjudication.covered_items || [], 'good')}
    ${renderProcedures('Rejected / Non-Claimable Items', adjudication.non_claimable_procedures || adjudication.rejected_items || [], 'bad')}
    ${renderProcedures('Claimable Documents', getClaimableDocumentRows(result), 'neutral')}

    <section class="result-section">
      <h3>Checks</h3>
      ${renderCheckCards(adjudication.checks || (precheck.decision ? { preliminary_eligibility: precheck } : {}))}
    </section>

    ${renderCompleteJsonOutput(result)}
  `;
}

function updateManualReviewButton() {
  const isManualReview =
    latestResult?.adjudication?.decision === 'MANUAL_REVIEW' ||
    latestResult?.precheck?.decision === 'MANUAL_REVIEW';
  const canSave =
    latestResult &&
    isManualReview &&
    latestResult.persisted !== true &&
    latestResult.claim_saved !== true &&
    !latestResult.saved_claim_id;

  saveManualReviewButton.classList.toggle('hidden', !canSave);
}

documentsInput.addEventListener('change', renderFiles);

document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab-button').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(button.dataset.tab).classList.add('active');

    if (button.dataset.tab === 'setupTab') {
      refreshAdminLists();
    }
  });
});

function renderAdminSelects() {
  const employeeUsers = adminUsers.filter((user) => user.member_type !== 'Dependent');

  primaryMemberSelect.innerHTML =
    '<option value="">Select employee</option>' +
    employeeUsers.map((user) => optionHtml(user.member_id, `${user.member_id} - ${user.member_name}`)).join('');

  linkUserSelect.innerHTML =
    '<option value="">Select user</option>' +
    adminUsers.map((user) => optionHtml(user.member_id, `${user.member_id} - ${user.member_name}`)).join('');

  linkPolicySelect.innerHTML =
    '<option value="">Select policy</option>' +
    adminPolicies.map((policy) => optionHtml(policy.policy_id, `${policy.policy_id} - ${policy.policy_name}`)).join('');
}

async function refreshAdminLists(options = {}) {
  setAdminStatus('Loading...', 'loading');

  try {
    const [usersResponse, policiesResponse] = await Promise.all([
      fetch('/api/admin/users'),
      fetch('/api/admin/policies'),
    ]);
    const usersData = await usersResponse.json();
    const policiesData = await policiesResponse.json();

    if (!usersResponse.ok) throw usersData;
    if (!policiesResponse.ok) throw policiesData;

    adminUsers = usersData.users || [];
    adminPolicies = policiesData.policies || [];
    renderAdminSelects();

    if (options.render !== false) {
      renderAdminJson({
        users_count: adminUsers.length,
        policies_count: adminPolicies.length,
        users: adminUsers,
        policies: adminPolicies,
      });
    }

    setAdminStatus('Ready', 'success');
  } catch (error) {
    renderAdminJson(error);
    setAdminStatus('Load failed', 'error');
  }
}

memberTypeInput.addEventListener('change', () => {
  primaryMemberField.classList.toggle('hidden', memberTypeInput.value !== 'Dependent');
  primaryMemberSelect.required = memberTypeInput.value === 'Dependent';
});

refreshAdminButton.addEventListener('click', refreshAdminLists);

async function submitJsonForm(targetForm, url, successText) {
  setAdminStatus('Saving...', 'loading');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formToJson(targetForm)),
    });
    const data = await response.json();

    if (!response.ok) {
      throw data;
    }

    renderAdminJson(data);
    setAdminStatus(successText, 'success');
    await refreshAdminLists({ render: false });
  } catch (error) {
    renderAdminJson(error);
    setAdminStatus('Save failed', 'error');
  }
}

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitJsonForm(userForm, '/api/admin/users', 'User saved');
});

policyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitJsonForm(policyForm, '/api/admin/policies', 'Policy saved');
});

linkPolicyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitJsonForm(linkPolicyForm, '/api/admin/user-policies', 'Linked');
});

clearButton.addEventListener('click', () => {
  form.reset();
  fileList.textContent = 'No files selected.';
  latestResult = null;
  renderJson({});
  setStatus('Ready');
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(output.textContent);
  setStatus('Copied', 'success');
});

downloadButton.addEventListener('click', () => {
  downloadJsonFile(`claim-result-full-${Date.now()}.json`, latestResult || {});
  setStatus('Downloaded', 'success');
});

downloadSummaryButton.addEventListener('click', () => {
  downloadJsonFile(`claim-result-summary-${Date.now()}.json`, getResultSummary(latestResult || {}));
  setStatus('Summary downloaded', 'success');
});

saveManualReviewButton.addEventListener('click', async () => {
  const isManualReview =
    latestResult?.adjudication?.decision === 'MANUAL_REVIEW' ||
    latestResult?.precheck?.decision === 'MANUAL_REVIEW';

  if (!latestResult || !isManualReview) {
    return;
  }

  saveManualReviewButton.disabled = true;
  setStatus('Saving...', 'loading');

  try {
    const response = await fetch('/api/claims/save-manual-review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(latestResult),
    });
    const data = await response.json();

    if (!response.ok) {
      throw data;
    }

    renderJson({
      ...latestResult,
      persisted: true,
      claim_saved: true,
      claim_id: data.claim_id,
      saved_claim_id: data.saved_claim_id,
      manual_review_save_result: data,
    });
    setStatus('Saved', 'success');
  } catch (error) {
    renderJson({
      ...latestResult,
      manual_review_save_error: error,
    });
    setStatus('Save failed', 'error');
  } finally {
    saveManualReviewButton.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const files = Array.from(documentsInput.files || []);

  if (files.length === 0) {
    setStatus('Select files', 'error');
    renderJson({ error: 'Please select at least one document.' });
    return;
  }

  const formData = new FormData();

  formData.append('member_id', memberIdInput.value.trim());
  formData.append('member_name', memberNameInput.value.trim());
  formData.append('claim_amount', claimAmountInput.value.trim() || '0');
  formData.append('adjudication_mode', adjudicationModeInput.value);

  if (submissionDateInput.value) {
    formData.append('submission_date', submissionDateInput.value);
  }

  if (previousConditionsInput.value.trim()) {
    formData.append('previous_medical_conditions', previousConditionsInput.value.trim());
  }

  if (updateDbOnManualReviewInput.checked) {
    formData.append('update_db_on_manual_review', 'true');
  }

  files.forEach((file) => {
    formData.append('documents', file);
  });

  if (instructionsInput.value.trim()) {
    formData.append('instructions', instructionsInput.value.trim());
  }

  submitButton.disabled = true;
  setStatus('Checking...', 'loading');
  renderJson({ status: 'Extracting document dates first, then checking preliminary eligibility and adjudicating claim...' });

  try {
    const response = await fetch('/api/claims/submit', {
      method: 'POST',
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw data;
    }

    renderJson(data);
    setStatus('Done', 'success');
  } catch (error) {
    renderJson(error);
    setStatus('Error', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

renderFiles();
