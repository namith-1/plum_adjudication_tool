const express = require('express');
const multer = require('multer');
const { verifyUserPolicy } = require('../services/claimVerificationService');
const {
  submitClaimForAdjudication,
  submitExtractedJsonForAdjudication,
  saveManualReviewClaim,
} = require('../services/claimSubmissionService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 10,
  },
});

router.post('/verify', async (req, res, next) => {
  try {
    const result = await verifyUserPolicy(req.body);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/submit', upload.array('documents', 10), async (req, res, next) => {
  try {
    const result = await submitClaimForAdjudication(req.body, req.files || []);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/test-json', async (req, res, next) => {
  try {
    const result = await submitExtractedJsonForAdjudication(req.body);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/save-manual-review', async (req, res, next) => {
  try {
    const result = await saveManualReviewClaim(req.body);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
