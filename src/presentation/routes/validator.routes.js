const express = require('express');
const router = express.Router();
const upload = require('../../middleware/upload');

const { 
  validateExcelController, 
  downloadCorrectedFileController 
} = require('../controllers/validation.controller');

router.post('/validate-excel', upload, validateExcelController);

router.get('/download-corrected/:filename', downloadCorrectedFileController);

module.exports = router;