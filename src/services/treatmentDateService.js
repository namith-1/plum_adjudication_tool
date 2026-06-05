function isValidDateString(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const date = new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime());
}

function addDate(value, source, dates) {
  if (isValidDateString(value)) {
    dates.push({ date: value, source });
  }
}

function collectDocumentDates(extraction) {
  const dates = [];
  const claimExtraction = extraction?.claim_extraction;
  const summaryRange = claimExtraction?.summary?.overall_treatment_date_range;
  const documents = claimExtraction?.documents || {};

  addDate(summaryRange?.start_date, 'summary.overall_treatment_date_range.start_date', dates);
  addDate(summaryRange?.end_date, 'summary.overall_treatment_date_range.end_date', dates);

  for (const prescription of documents.prescriptions || []) {
    addDate(prescription.clinical_details?.date, 'prescription.clinical_details.date', dates);
    addDate(prescription.follow_up_date, 'prescription.follow_up_date', dates);
  }

  for (const bill of documents.medical_bills || []) {
    addDate(bill.bill_details?.date, 'medical_bill.bill_details.date', dates);
  }

  for (const report of documents.diagnostic_reports || []) {
    addDate(report.report_details?.date, 'diagnostic_report.report_details.date', dates);
  }

  for (const bill of documents.pharmacy_bills || []) {
    addDate(bill.bill_details?.date, 'pharmacy_bill.bill_details.date', dates);
  }

  return dates;
}

function inferTreatmentDate(extraction) {
  const dates = collectDocumentDates(extraction);

  if (dates.length === 0) {
    return {
      treatment_date: null,
      confidence: 0,
      evidence: [],
      notes: 'No valid treatment/document dates were extracted.',
    };
  }

  const counts = new Map();

  for (const item of dates) {
    counts.set(item.date, (counts.get(item.date) || 0) + 1);
  }

  const [bestDate, bestCount] = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return new Date(a[0]) - new Date(b[0]);
  })[0];

  return {
    treatment_date: bestDate,
    confidence: bestCount / dates.length,
    evidence: dates,
    notes:
      counts.size === 1
        ? 'All extracted document dates match.'
        : 'Multiple dates found. Selected the most frequent/earliest treatment episode date.',
  };
}

module.exports = {
  inferTreatmentDate,
};
