const express = require('express');
const multer = require('multer');
const { extractOpdDocuments } = require('../services/grokExtractionService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 10,
  },
});

async function handleExtraction(req, res, next) {
  try {
    const result = await extractOpdDocuments(req.body, req.files || []);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

router.post('/groq', upload.array('documents', 10), handleExtraction);
router.post('/grok', upload.array('documents', 10), handleExtraction);

module.exports = router;
