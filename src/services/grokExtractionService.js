const OPD_EXTRACTION_PROMPT = require('../prompts/opdExtractionPrompt');
const { filesToContentParts } = require('./documentContentService');
const { callGroqJson } = require('./groqClient');

const MAX_IMAGES_PER_AI_REQUEST = Number(process.env.AI_MAX_IMAGES_PER_REQUEST || 5);

function getDocumentUrl(document) {
  if (document.image_url) {
    return document.image_url;
  }

  if (document.file_url) {
    return document.file_url;
  }

  if (document.data_base64) {
    const mimeType = document.mime_type || 'image/jpeg';
    return `data:${mimeType};base64,${document.data_base64}`;
  }

  return null;
}

function jsonDocumentToContentPart(document, index) {
  const url = getDocumentUrl(document);

  if (url) {
    return {
      type: 'image_url',
      image_url: { url },
    };
  }

  if (document.text) {
    return {
      type: 'text',
      text: `Document ${index + 1}:\n\n${document.text}`,
    };
  }

  return null;
}

function splitContentIntoBatches(contentParts) {
  const batches = [];
  let currentBatch = [];
  let currentImageCount = 0;

  for (const part of contentParts) {
    const isImage = part.type === 'image_url';

    if (isImage && currentImageCount >= MAX_IMAGES_PER_AI_REQUEST) {
      batches.push(currentBatch);
      currentBatch = [];
      currentImageCount = 0;
    }

    currentBatch.push(part);

    if (isImage) {
      currentImageCount += 1;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function minDate(values) {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  return dates[0]?.toISOString().slice(0, 10) || null;
}

function maxDate(values) {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return dates[0]?.toISOString().slice(0, 10) || null;
}

function normalizeClaimExtraction(extraction) {
  if (extraction?.claim_extraction) {
    return extraction.claim_extraction;
  }

  return extraction || {};
}

function mergeExtractionJson(extractions) {
  const normalized = extractions.map(normalizeClaimExtraction);
  const summaries = normalized.map((item) => item.summary || {});
  const dateStarts = summaries.map((summary) => summary.overall_treatment_date_range?.start_date);
  const dateEnds = summaries.map((summary) => summary.overall_treatment_date_range?.end_date);
  const mergedDocuments = {
    prescriptions: [],
    medical_bills: [],
    diagnostic_reports: [],
    pharmacy_bills: [],
  };

  for (const extraction of normalized) {
    const documents = extraction.documents || {};

    for (const [key, value] of Object.entries(documents)) {
      if (!Array.isArray(value)) {
        continue;
      }

      if (!mergedDocuments[key]) {
        mergedDocuments[key] = [];
      }

      mergedDocuments[key].push(...value);
    }
  }

  return {
    claim_extraction: {
      summary: {
        overall_treatment_date_range: {
          start_date: minDate(dateStarts),
          end_date: maxDate(dateEnds),
        },
        consistent_patient_name: summaries.find((summary) => summary.consistent_patient_name)?.consistent_patient_name || null,
        consistent_doctor_names: uniqueStrings(summaries.flatMap((summary) => summary.consistent_doctor_names || [])),
        all_diagnoses: uniqueStrings(summaries.flatMap((summary) => summary.all_diagnoses || [])),
      },
      documents: mergedDocuments,
    },
  };
}

async function extractContentBatch(contentParts, input, batchIndex, totalBatches) {
  const batchNote =
    totalBatches > 1
      ? `This is batch ${batchIndex + 1} of ${totalBatches}. Extract only the documents visible in this batch.`
      : '';

  return callGroqJson([
    {
      role: 'system',
      content: OPD_EXTRACTION_PROMPT,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [input.instructions || 'Extract the OPD claim data from these documents using the required JSON schema.', batchNote]
            .filter(Boolean)
            .join('\n\n'),
        },
        ...contentParts,
      ],
    },
  ]);
}

async function extractOpdDocuments(input, files = []) {
  const documents = input.documents || [];

  if ((!Array.isArray(documents) || documents.length === 0) && files.length === 0) {
    const error = new Error('documents must be a non-empty array');
    error.statusCode = 400;
    throw error;
  }

  const jsonContent = documents.map((document, index) => {
    const contentPart = jsonDocumentToContentPart(document, index);

    if (!contentPart) {
      const error = new Error(`documents[${index}] must include image_url, file_url, data_base64, or text`);
      error.statusCode = 400;
      throw error;
    }

    return contentPart;
  });
  const fileContent = await filesToContentParts(files);
  const documentContent = [...jsonContent, ...fileContent];
  const contentBatches = splitContentIntoBatches(documentContent);
  const groqResults = [];

  for (let index = 0; index < contentBatches.length; index += 1) {
    groqResults.push(await extractContentBatch(contentBatches[index], input, index, contentBatches.length));
  }
  const extraction =
    groqResults.length === 1
      ? groqResults[0].json
      : mergeExtractionJson(groqResults.map((result) => result.json));

  return {
    model: groqResults.map((result) => result.model).filter(Boolean).join(', ') || null,
    extraction,
    batches_processed: groqResults.length,
  };
}

module.exports = {
  extractOpdDocuments,
};
