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

function renderResultView(result) {
  if (!result || Object.keys(result).length === 0 || result.status) {
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
      ['Requested', formatMoney(adjudication.claimed_amount_from_request || amountSummary.claimed_amount_from_request || precheck.claim?.claim_amount)],
      ['Approved', formatMoney(adjudication.approved_amount)],
      ['Calculated', formatMoney(adjudication.calculated_claimable_amount || amountSummary.total_extracted_bill_amount)],
      ['Treatment date', result.inferred_treatment_date?.treatment_date || precheck.claim?.treatment_date || 'Unknown'],
      ['Submission date', precheck.claim?.submission_date || 'Not provided'],
      ['Utilization updated', result.utilization_updated ? 'Yes' : 'No'],
    ])}

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
    ${renderProcedures('Claimable Documents', adjudication.claimable_documents || [], 'neutral')}

    <section class="result-section">
      <h3>Checks</h3>
      ${renderCheckCards(adjudication.checks || (precheck.decision ? { preliminary_eligibility: precheck } : {}))}
    </section>
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
  const blob = new Blob([output.textContent], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `claim-result-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus('Downloaded', 'success');
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
  formData.append('claim_amount', claimAmountInput.value.trim());
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
