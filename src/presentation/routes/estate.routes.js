const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { excelExtractController } = require('../controllers/excel.controller');

const router = express.Router();

// Configure multer for multiple file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Keep original filename for easier matching
    const originalName = path.parse(file.originalname).name;
    const ext = path.extname(file.originalname);
    cb(null, originalName + '-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExcelTypes = ['.xlsx', '.xls', '.csv'];
  const allowedPdfTypes = ['.pdf'];
  
  const fileExt = path.extname(file.originalname).toLowerCase();
  
  if (file.fieldname === 'excelFile' && allowedExcelTypes.includes(fileExt)) {
    cb(null, true);
  } else if (file.fieldname === 'pdfFiles' && allowedPdfTypes.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type for ${file.fieldname}. Excel: ${allowedExcelTypes.join(', ')}, PDF: ${allowedPdfTypes.join(', ')}`), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 50 // Maximum 50 files total
  }
});

// POST /api/estate/excel-extract - Extract data from Excel file with PDF support
router.post('/excel-extract', 
  upload.fields([
    { name: 'excelFile', maxCount: 1 },
    { name: 'pdfFiles', maxCount: 49 }
  ]), 
  excelExtractController
);

module.exports = router;