const express = require('express');
const router = express.Router();
const upload = require('../../middleware/upload'); // Import the same middleware

const { excelExtractController } = require('../controllers/excel.controller');
const {
  getAllReportsController,
  getAllReportsSimpleController,
  getReportByIdController,
  getBatchStatsController
} = require('../controllers/getReports.controller'); 

// Use the same upload middleware
router.post('/excel-extract', upload, excelExtractController);

// NEW ROUTES FOR GETTING REPORTS
router.get('/reports', getAllReportsController);
router.get('/reports/all', getAllReportsSimpleController);
router.get('/reports/batch-stats', getBatchStatsController);
router.get('/reports/:id', getReportByIdController);

module.exports = router;