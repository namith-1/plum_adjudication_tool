const path = require('path');
const { pathToFileURL } = require('url');
const mammoth = require('mammoth');

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

function getExtension(filename = '') {
  return path.extname(filename).toLowerCase();
}

function toDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function textPart(filename, text) {
  return {
    type: 'text',
    text: `Document: ${filename}\n\n${text}`,
  };
}

function directoryFileUrl(directoryPath) {
  return pathToFileURL(`${directoryPath}${path.sep}`).href;
}

function getPdfToImgAssetUrls() {
  const pdfToImgEntry = require.resolve('pdf-to-img');
  const pdfToImgRoot = path.resolve(path.dirname(pdfToImgEntry), '..');
  const pdfjsRoot = path.join(pdfToImgRoot, 'node_modules', 'pdfjs-dist');

  return {
    standardFontDataUrl: directoryFileUrl(path.join(pdfjsRoot, 'standard_fonts')),
    cMapUrl: directoryFileUrl(path.join(pdfjsRoot, 'cmaps')),
  };
}

function ensurePdfDomGlobals() {
  const canvas = require('@napi-rs/canvas');
  const globals = ['DOMMatrix', 'DOMPoint', 'DOMRect', 'ImageData', 'Path2D'];

  for (const key of globals) {
    if (!globalThis[key] && canvas[key]) {
      globalThis[key] = canvas[key];
    }
  }
}

async function renderPdfPagesToImageParts(file) {
  ensurePdfDomGlobals();
  const { pdf } = await import('pdf-to-img');
  const configuredMaxPages = Number(process.env.PDF_MAX_PAGES || 20);
  const maxPages = Math.max(configuredMaxPages, 20);
  const scale = Number(process.env.PDF_IMAGE_SCALE || 3);
  const document = await pdf(file.buffer, {
    scale,
    docInitParams: {
      ...getPdfToImgAssetUrls(),
      cMapPacked: true,
      isEvalSupported: false,
      verbosity: 0,
    },
  });

  try {
    const pageCount = Math.min(document.length, maxPages);
    const parts = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const imageBuffer = await document.getPage(pageNumber);
      parts.push({
        type: 'text',
        text: `Document: ${file.originalname}, page ${pageNumber} of ${document.length}`,
      });
      parts.push({
        type: 'image_url',
        image_url: {
          url: toDataUrl(imageBuffer, 'image/png'),
        },
      });
    }

    return parts;
  } finally {
    await document.destroy();
  }
}

async function extractTextFilePart(file) {
  const extension = getExtension(file.originalname);

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return textPart(file.originalname, result.value);
  }

  return textPart(file.originalname, file.buffer.toString('utf8'));
}

async function fileToContentParts(file) {
  const extension = getExtension(file.originalname);

  if (IMAGE_MIME_TYPES.has(file.mimetype)) {
    return [
      {
        type: 'image_url',
        image_url: {
          url: toDataUrl(file.buffer, file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype),
        },
      },
    ];
  }

  if (file.mimetype === 'application/pdf' || extension === '.pdf') {
    return renderPdfPagesToImageParts(file);
  }

  if (TEXT_MIME_TYPES.has(file.mimetype) || ['.txt', '.md', '.csv', '.json', '.doc', '.docx'].includes(extension)) {
    return [await extractTextFilePart(file)];
  }

  const error = new Error(`Unsupported file type for ${file.originalname}`);
  error.statusCode = 400;
  throw error;
}

async function filesToContentParts(files = []) {
  const contentParts = [];

  for (const file of files) {
    contentParts.push(...(await fileToContentParts(file)));
  }

  return contentParts;
}

module.exports = {
  filesToContentParts,
};
