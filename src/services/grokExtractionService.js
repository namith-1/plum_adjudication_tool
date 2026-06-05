const OPD_EXTRACTION_PROMPT = require('../prompts/opdExtractionPrompt');
const { filesToContentParts } = require('./documentContentService');
const { callGroqJson } = require('./groqClient');

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
  const imageCount = documentContent.filter((part) => part.type === 'image_url').length;

  if (imageCount > 5) {
    const error = new Error('Groq vision models support up to 5 images per request. Reduce image/PDF page count.');
    error.statusCode = 400;
    throw error;
  }

  const groqResult = await callGroqJson([
    {
      role: 'system',
      content: OPD_EXTRACTION_PROMPT,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: input.instructions || 'Extract the OPD claim data from these documents using the required JSON schema.',
        },
        ...documentContent,
      ],
    },
  ]);

  return {
    model: groqResult.model,
    extraction: groqResult.json,
  };
}

module.exports = {
  extractOpdDocuments,
};
