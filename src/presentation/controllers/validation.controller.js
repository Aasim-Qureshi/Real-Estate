// controllers/validation.controller.js
const { 
  validateExcelData, 
  generateCorrectedExcel, 
  extractDataForValidation 
} = require('../../utils/excelValidator');
const fs = require('fs');
const path = require('path');

/**
 * Validate Excel file endpoint
 */
const validateExcelController = async (req, res) => {
  let excelFile = null;
  let tempFiles = []; // Track files to clean up

  try {
    if (!req.files) {
      return res.status(400).json({
        success: false,
        isValid: false,
        message: 'No files uploaded'
      });
    }

    excelFile = req.files.excelFile ? req.files.excelFile[0] : null;
    const pdfFiles = req.files.pdfFiles || [];

    if (!excelFile) {
      return res.status(400).json({
        success: false,
        isValid: false,
        message: 'No Excel file uploaded'
      });
    }

    console.log(`[validateExcelController] Validating: ${excelFile.originalname} with ${pdfFiles.length} PDFs`);

    // Extract data from Excel
    const { structuredData, originalFilePath } = extractDataForValidation(excelFile);
    
    // Validate the data with PDF files
    const validationResults = validateExcelData(structuredData, pdfFiles);
    
    let correctedFileInfo = null;
    
    // Generate corrected file if there are errors
    if (!validationResults.isValid) {
      correctedFileInfo = generateCorrectedExcel(structuredData, validationResults, originalFilePath);
      tempFiles.push(correctedFileInfo.filePath);
    }

    // Prepare response
    const response = {
      success: true,
      isValid: validationResults.isValid,
      summary: {
        totalRows: validationResults.totalRows,
        errorCount: validationResults.errorCount,
        warningCount: validationResults.warningCount
      },
      errors: validationResults.errors,
      warnings: validationResults.warnings,
      pdfStats: validationResults.pdfStats
    };

    // Add corrected file info if available
    if (correctedFileInfo) {
      response.correctedFile = {
        fileName: correctedFileInfo.fileName,
        downloadUrl: `/api/validate/download-corrected/${correctedFileInfo.fileName}` // Fixed URL path
      };
    }

    res.json(response);

  } catch (error) {
    console.error('[validateExcelController] Error:', error);
    
    // Clean up temp files
    tempFiles.forEach(filePath => {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          console.error('Error cleaning up temp file:', cleanupError);
        }
      }
    });

    res.status(500).json({
      success: false,
      isValid: false,
      message: 'Validation failed',
      error: error.message
    });
  }
};

/**
 * Download corrected file endpoint - COMPLETELY REWRITTEN
 */
const downloadCorrectedFileController = (req, res) => {
  try {
    const fileName = req.params.filename;
    
    // Security check - ensure filename is safe
    if (!fileName || fileName.includes('..') || !fileName.startsWith('corrected_')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename'
      });
    }

    const filePath = path.join(__dirname, '../../temp', fileName);
    
    console.log(`[downloadCorrectedFileController] Downloading: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      console.error(`[downloadCorrectedFileController] File not found: ${filePath}`);
      return res.status(404).json({
        success: false,
        message: 'Corrected file not found or has expired'
      });
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    console.log(`[downloadCorrectedFileController] File size: ${stats.size} bytes`);

    // Set proper headers for Excel file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Read file and send it
    const fileBuffer = fs.readFileSync(filePath);
    res.send(fileBuffer);

    // Clean up file after successful download
    console.log(`[downloadCorrectedFileController] Download completed, cleaning up: ${filePath}`);
    setTimeout(() => {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`[downloadCorrectedFileController] Successfully cleaned up: ${filePath}`);
        } catch (cleanupError) {
          console.error('Error cleaning up file:', cleanupError);
        }
      }
    }, 1000);

  } catch (error) {
    console.error('[downloadCorrectedFileController] Error:', error);
    
    // Don't send JSON error if headers are already sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download corrected file',
        error: error.message
      });
    }
  }
};

module.exports = {
  validateExcelController,
  downloadCorrectedFileController
};