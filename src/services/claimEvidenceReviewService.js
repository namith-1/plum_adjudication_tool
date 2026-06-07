function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function hasAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function addMissing(result, documentType, field, severity, impact) {
  result.missing_fields.push({ document_type: documentType, field, severity, impact });

  if (severity === 'critical') {
    result.flags.push(`Critical missing field: ${documentType}.${field}`);
  }
}

function addAuthWarning(result, documentType, marker, impact) {
  result.authenticity_warnings.push({ document_type: documentType, marker, impact });
  result.flags.push(`Missing authenticity marker: ${documentType}.${marker}`);
}

function reviewPrescription(doc, result) {
  const documentType = 'Prescription';

  if (!hasValue(doc.patient_info?.name)) addMissing(result, documentType, 'patient_info.name', 'critical', 'Cannot verify patient identity.');
  if (!hasValue(doc.clinical_details?.date)) addMissing(result, documentType, 'clinical_details.date', 'critical', 'Cannot link prescription to treatment date.');
  if (!hasValue(doc.doctor_info?.name) && !hasValue(doc.clinic_info?.name)) {
    addMissing(result, documentType, 'doctor_or_clinic_name', 'critical', 'Cannot verify prescription issuer.');
  }

  const hasMedicalSupport =
    safeArray(doc.prescribed_medicines).length > 0 ||
    safeArray(doc.investigations_advised).length > 0 ||
    safeArray(doc.clinical_details?.diagnosis).length > 0 ||
    safeArray(doc.clinical_details?.chief_complaints).length > 0;

  if (!hasMedicalSupport) {
    addMissing(result, documentType, 'medical_support', 'major', 'No medicines, investigations, diagnosis, or complaint found.');
  }

  if (result.mode === 'strict' && !hasValue(doc.doctor_info?.registration_number) && doc.signatures_and_stamps_detected !== true) {
    addAuthWarning(result, documentType, 'doctor_registration_or_stamp_signature', 'Weak prescription authenticity evidence.');
  }
}

function reviewMedicalBill(doc, result) {
  const documentType = 'Medical Bill';
  const totalAmount = doc.financials?.total_amount;

  if (!hasValue(doc.hospital_info?.name)) addMissing(result, documentType, 'hospital_info.name', 'critical', 'Cannot verify bill provider.');
  if (!hasValue(doc.bill_details?.date)) addMissing(result, documentType, 'bill_details.date', 'critical', 'Cannot link bill to treatment date.');
  if (!hasValue(doc.patient_info?.name)) addMissing(result, documentType, 'patient_info.name', 'critical', 'Cannot verify bill patient.');
  if (!hasAmount(totalAmount) && safeArray(doc.line_items).length === 0) {
    addMissing(result, documentType, 'financials.total_amount_or_line_items', 'critical', 'Cannot calculate claimable bill amount.');
  }

  if (result.mode === 'strict' && !hasValue(doc.hospital_info?.gst_number) && doc.signatures_and_stamps_detected !== true) {
    addAuthWarning(result, documentType, 'gst_or_stamp_signature', 'Weak medical bill authenticity evidence.');
  }
}

function reviewDiagnosticReport(doc, result) {
  const documentType = 'Diagnostic Report';

  if (!hasValue(doc.lab_info?.name)) addMissing(result, documentType, 'lab_info.name', 'critical', 'Cannot verify diagnostic provider.');
  if (!hasValue(doc.patient_info?.name)) addMissing(result, documentType, 'patient_info.name', 'critical', 'Cannot verify report patient.');
  if (!hasValue(doc.report_details?.date)) addMissing(result, documentType, 'report_details.date', 'critical', 'Cannot link report to treatment date.');
  if (safeArray(doc.test_results).length === 0) addMissing(result, documentType, 'test_results', 'critical', 'No test identity/result found.');

  if (result.mode === 'strict' && !hasValue(doc.lab_info?.accreditation_number) && !hasValue(doc.report_details?.pathologist_name) && doc.signatures_and_stamps_detected !== true) {
    addAuthWarning(result, documentType, 'accreditation_pathologist_or_stamp_signature', 'Weak diagnostic report authenticity evidence.');
  }
}

function reviewPharmacyBill(doc, result) {
  const documentType = 'Pharmacy Bill';
  const totalAmount = doc.financials?.net_payable || doc.financials?.total_amount;

  if (!hasValue(doc.pharmacy_info?.name)) addMissing(result, documentType, 'pharmacy_info.name', 'critical', 'Cannot verify pharmacy provider.');
  if (!hasValue(doc.bill_details?.date)) addMissing(result, documentType, 'bill_details.date', 'critical', 'Cannot link pharmacy bill to treatment date.');
  if (safeArray(doc.line_items).length === 0) addMissing(result, documentType, 'line_items', 'critical', 'No medicine items found.');
  if (!hasAmount(totalAmount)) addMissing(result, documentType, 'financials.total_amount_or_net_payable', 'critical', 'Cannot calculate pharmacy claim amount.');

  if (result.mode === 'strict' && !hasValue(doc.pharmacy_info?.drug_license_number) && !hasValue(doc.pharmacy_info?.gst_number)) {
    addAuthWarning(result, documentType, 'drug_license_or_gst', 'Weak pharmacy bill authenticity evidence.');
  }
}

function reviewClaimEvidence(extraction, options = {}) {
  const documents = extraction?.claim_extraction?.documents || {};
  const mode = options.mode === 'strict' ? 'strict' : 'normal';
  const result = {
    mode,
    missing_fields: [],
    authenticity_warnings: [],
    flags: [],
  };

  safeArray(documents.prescriptions).forEach((doc) => reviewPrescription(doc, result));
  safeArray(documents.medical_bills).forEach((doc) => reviewMedicalBill(doc, result));
  safeArray(documents.diagnostic_reports).forEach((doc) => reviewDiagnosticReport(doc, result));
  safeArray(documents.pharmacy_bills).forEach((doc) => reviewPharmacyBill(doc, result));

  result.has_critical_missing_fields = result.missing_fields.some((field) => field.severity === 'critical');
  result.needs_manual_review =
    result.has_critical_missing_fields ||
    (mode === 'strict' && result.authenticity_warnings.length > 0);

  return result;
}

function applyEvidenceReview(adjudication, evidenceReview) {
  if (!evidenceReview.needs_manual_review || !['APPROVED', 'PARTIAL'].includes(adjudication?.decision)) {
    return adjudication;
  }

  const reviewReason =
    evidenceReview.authenticity_warnings.length > 0
      ? 'important missing fields or weak authenticity markers require manual review'
      : 'important missing fields require manual review';

  return {
    ...adjudication,
    decision: 'MANUAL_REVIEW',
    approved_amount: 0,
    tags: Array.from(
      new Set([
        ...(adjudication.tags || []),
        evidenceReview.authenticity_warnings.length > 0 ? 'AUTHENTICITY_REVIEW' : null,
        evidenceReview.has_critical_missing_fields ? 'MISSING_CRITICAL_FIELDS' : null,
      ].filter(Boolean))
    ),
    flags: Array.from(new Set([...(adjudication.flags || []), ...evidenceReview.flags])),
    notes: `${adjudication.notes || ''} Backend override: ${reviewReason}.`.trim(),
    checks: {
      ...(adjudication.checks || {}),
      backend_evidence_review: {
        status: 'failed',
        passed: false,
        reason:
          evidenceReview.authenticity_warnings.length > 0
            ? 'Backend found critical missing fields or weak authenticity evidence in extracted JSON.'
            : 'Backend found critical missing fields in extracted JSON.',
        evidence_used: [
          JSON.stringify(evidenceReview.missing_fields),
          JSON.stringify(evidenceReview.authenticity_warnings),
        ],
        failure_code: 'MANUAL_REVIEW_REQUIRED',
      },
    },
    backend_evidence_review: evidenceReview,
  };
}

module.exports = {
  reviewClaimEvidence,
  applyEvidenceReview,
};
