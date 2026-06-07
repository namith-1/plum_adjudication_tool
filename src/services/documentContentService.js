const path = require('path');
const { pathToFileURL } = require('url');
const { createCanvas } = require('@napi-rs/canvas');
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

function packageDirectoryUrl(packagePath) {
  const directoryPath = path.dirname(require.resolve(packagePath));
  return pathToFileURL(`${directoryPath}${path.sep}`).href;
}

async function renderPdfPagesToImageParts(file) {
  const pdfWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');

  globalThis.pdfjsWorker = pdfWorker;

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = packageDirectoryUrl('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf');
  const configuredMaxPages = Number(process.env.PDF_MAX_PAGES || 20);
  const maxPages = Math.max(configuredMaxPages, 20);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(file.buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    standardFontDataUrl,
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const parts = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext('2d');

    await page.render({ canvasContext, viewport }).promise;

    const imageBuffer = canvas.toBuffer('image/jpeg', 0.9);
    parts.push({
      type: 'image_url',
      image_url: {
        url: toDataUrl(imageBuffer, 'image/jpeg'),
      },
    });
  }

  return parts;
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
