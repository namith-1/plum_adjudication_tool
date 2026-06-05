function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactQuality(document) {
  return {
    confidence: document.data_quality?.overall_confidence_score,
    blur_level: document.data_quality?.blur_level,
    is_cropped_or_cut_off: document.data_quality?.is_cropped_or_cut_off,
    field_issues: safeArray(document.data_quality?.field_issues).map((issue) => ({
      expected_field: issue.expected_field,
      issue_type: issue.issue_type,
      severity: issue.severity,
      ai_note: issue.ai_note,
    })),
  };
}

function summarizeExtraction(extraction) {
  const documents = extraction?.claim_extraction?.documents || {};
  const summary = extraction?.claim_extraction?.summary || {};
  const prescriptions = safeArray(documents.prescriptions).map((doc) => ({
    quality: compactQuality(doc),
    clinic_name: doc.clinic_info?.name,
    doctor_name: doc.doctor_info?.name,
    doctor_registration_number: doc.doctor_info?.registration_number,
    patient: doc.patient_info,
    date: doc.clinical_details?.date,
    complaints: doc.clinical_details?.chief_complaints,
    diagnosis: doc.clinical_details?.diagnosis,
    prescribed_medicines: doc.prescribed_medicines,
    investigations_advised: doc.investigations_advised,
    follow_up_date: doc.follow_up_date,
  }));
  const medicalBills = safeArray(documents.medical_bills).map((doc) => ({
    quality: compactQuality(doc),
    hospital_name: doc.hospital_info?.name,
    bill_number: doc.bill_details?.bill_number,
    date: doc.bill_details?.date,
    referring_doctor: doc.bill_details?.referring_doctor,
    patient: doc.patient_info,
    line_items: doc.line_items,
    financials: doc.financials,
  }));
  const diagnosticReports = safeArray(documents.diagnostic_reports).map((doc) => ({
    quality: compactQuality(doc),
    lab_name: doc.lab_info?.name,
    patient: doc.patient_info,
    report_id: doc.report_details?.report_id,
    date: doc.report_details?.date,
    referring_doctor: doc.report_details?.referring_doctor,
    test_results: doc.test_results,
    clinical_remarks: doc.clinical_remarks,
  }));
  const pharmacyBills = safeArray(documents.pharmacy_bills).map((doc) => ({
    quality: compactQuality(doc),
    pharmacy_name: doc.pharmacy_info?.name,
    bill_number: doc.bill_details?.bill_number,
    date: doc.bill_details?.date,
    prescribing_doctor: doc.bill_details?.prescribing_doctor,
    patient: doc.patient_info,
    line_items: doc.line_items,
    financials: doc.financials,
  }));

  return {
    summary: {
      treatment_date_range: summary.overall_treatment_date_range,
      patient_name: summary.consistent_patient_name,
      doctor_names: summary.consistent_doctor_names,
      diagnoses: summary.all_diagnoses,
    },
    documents_present: {
      prescriptions: prescriptions.length,
      medical_bills: medicalBills.length,
      diagnostic_reports: diagnosticReports.length,
      pharmacy_bills: pharmacyBills.length,
    },
    prescriptions,
    medical_bills: medicalBills,
    diagnostic_reports: diagnosticReports,
    pharmacy_bills: pharmacyBills,
  };
}

function detectClaimTopics(claimSummary) {
  const text = JSON.stringify(claimSummary).toLowerCase();
  const topics = new Set(['eligibility', 'documents', 'limits', 'duplicates']);

  if (text.includes('pharmacy') || text.includes('medicine') || text.includes('drug')) topics.add('pharmacy');
  if (text.includes('diagnostic') || text.includes('mri') || text.includes('ct scan') || text.includes('blood')) topics.add('diagnostic');
  if (text.includes('dental') || text.includes('tooth') || text.includes('root canal') || text.includes('whitening')) topics.add('dental');
  if (text.includes('vision') || text.includes('eye') || text.includes('glasses')) topics.add('vision');
  if (text.includes('ayurveda') || text.includes('homeopathy') || text.includes('unani') || text.includes('panchakarma')) topics.add('alternative_medicine');
  if (text.includes('cosmetic') || text.includes('weight loss') || text.includes('obesity')) topics.add('exclusions');
  if (text.includes('procedure') || text.includes('surgery') || text.includes('therapy')) topics.add('procedures');
  if (text.includes('stamp') || text.includes('signature') || text.includes('registration')) topics.add('authenticity');

  return Array.from(topics);
}

module.exports = {
  summarizeExtraction,
  detectClaimTopics,
};
