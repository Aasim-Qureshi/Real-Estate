// utils/excelValidator.js
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

/**
 * Extract PDF filename from various possible column names
 */
const extractPdfFileName = (record) => {
  // Try different possible column names for PDF filename
  const pdfFileName = record["Report Asset File"] || 
                     record["reportAssetFile"] || 
                     record["report_asset_file"] ||
                     record["Report_Asset_File"] ||
                     record["report_asset"] ||
                     record["pdf_file"] ||
                     record["Pdf File"];
  
  return pdfFileName ? String(pdfFileName).trim() : null;
};

/**
 * Normalize filename for comparison (remove paths, extensions, etc.)
 */
const normalizeFileName = (filename) => {
  if (!filename) return null;
  
  // Remove any directory paths and file extensions
  let name = path.basename(filename, path.extname(filename));
  
  // Remove common variations and normalize
  name = name.toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .trim();
  
  return name;
};

/**
 * Check if PDF file matches the expected filename
 */
const doesPdfMatch = (pdfFile, expectedFileName) => {
  if (!expectedFileName) return false;
  
  const pdfOriginalName = pdfFile.originalname;
  const pdfNormalized = normalizeFileName(pdfOriginalName);
  const expectedNormalized = normalizeFileName(expectedFileName);
  
  console.log(`[PDF Matching] Comparing: "${pdfNormalized}" with "${expectedNormalized}"`);
  
  return pdfNormalized === expectedNormalized;
};

/**
 * Validate Excel data with business rules including PDF matching
 */
const validateExcelData = (structuredData, pdfFiles = []) => {
  const errors = [];
  const warnings = [];
  let hasCriticalErrors = false;

  console.log(`[validateExcelData] Starting validation with ${structuredData.length} rows and ${pdfFiles.length} PDFs`);
  console.log(`[validateExcelData] Available PDFs:`, pdfFiles.map(p => p.originalname));

  structuredData.forEach((record, index) => {
    const rowNumber = record.rowNumber;

    // 1. Check for empty cells in required fields
    Object.keys(record).forEach(key => {
      if (key !== 'rowNumber' && key !== 'pdfFile' && key !== 'report_asset_file') {
        const value = record[key];
        if (value === '' || value === null || value === undefined) {
          errors.push({
            rowNumber,
            field: key,
            message: `Empty cell found in ${key}`,
            type: 'empty',
            critical: true
          });
          hasCriticalErrors = true;
        }
      }
    });

    // 2. Validate final_value is integer
    const finalValue = record.final_value || record.finalValue || record['Final Value'];
    if (finalValue && finalValue !== '') {
      const numValue = parseFloat(finalValue);
      if (isNaN(numValue) || !Number.isInteger(numValue)) {
        errors.push({
          rowNumber,
          field: 'final_value',
          message: `final_value must be an integer, got: ${finalValue}`,
          type: 'integer',
          critical: true
        });
        hasCriticalErrors = true;
      }
    }

    // 3. Validate date comparison: report_issuing_date >= valuation_date
    const reportIssuingDate = record.report_issuing_date || record.reportIssuingDate || record['Report Issuing Date'];
    const valuationDate = record.valuation_date || record.valuationDate || record['Valuation Date'];
    
    if (reportIssuingDate && valuationDate && reportIssuingDate !== '' && valuationDate !== '') {
      try {
        const reportDate = new Date(reportIssuingDate);
        const valuationDateObj = new Date(valuationDate);
        
        if (reportDate < valuationDateObj) {
          errors.push({
            rowNumber,
            field: 'report_issuing_date',
            message: `Report issuing date (${reportIssuingDate}) cannot be before valuation date (${valuationDate})`,
            type: 'date',
            critical: true
          });
          hasCriticalErrors = true;
        }
      } catch (dateError) {
        errors.push({
          rowNumber,
          field: 'report_issuing_date',
          message: `Invalid date format: ${dateError.message}`,
          type: 'date',
          critical: true
        });
        hasCriticalErrors = true;
      }
    }

    // 4. Validate PDF file matching
    const pdfFileName = extractPdfFileName(record);
    
    if (pdfFileName && pdfFileName !== '') {
      // Check if any uploaded PDF matches this filename
      const matchingPdf = pdfFiles.find(pdfFile => 
        doesPdfMatch(pdfFile, pdfFileName)
      );
      
      if (!matchingPdf) {
        errors.push({
          rowNumber,
          field: 'report_asset_file',
          message: `Matching PDF file not found for: "${pdfFileName}". Available PDFs: ${pdfFiles.map(f => f.originalname).join(', ')}`,
          type: 'pdf_missing',
          critical: true
        });
        hasCriticalErrors = true;
        
        console.log(`[PDF Validation] Row ${rowNumber}: No match found for "${pdfFileName}"`);
      } else {
        console.log(`[PDF Validation] Row ${rowNumber}: Successfully matched "${pdfFileName}" with "${matchingPdf.originalname}"`);
      }
    } else {
      warnings.push({
        rowNumber,
        field: 'report_asset_file',
        message: 'No PDF file specified for this row'
      });
      console.log(`[PDF Validation] Row ${rowNumber}: No PDF filename specified`);
    }
  });

  // Calculate PDF matching statistics
  const pdfStats = {
    totalPdfs: pdfFiles.length,
    totalRows: structuredData.length,
    rowsWithPdfSpecified: structuredData.filter(r => {
      const pdfName = extractPdfFileName(r);
      return pdfName && pdfName !== '';
    }).length,
    matchedPdfs: structuredData.filter(r => {
      const pdfFileName = extractPdfFileName(r);
      if (!pdfFileName || pdfFileName === '') return false;
      
      return pdfFiles.some(pdfFile => doesPdfMatch(pdfFile, pdfFileName));
    }).length
  };

  console.log(`[validateExcelData] Validation completed:`, pdfStats);

  return {
    isValid: !hasCriticalErrors,
    errors,
    warnings,
    totalRows: structuredData.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    pdfStats
  };
};


/**
 * Generate corrected Excel file with special characters for marked cells
 */
const generateCorrectedExcel = (structuredData, validationResults, originalFilePath) => {
  try {
    // Read the original workbook
    const workbook = XLSX.readFile(originalFilePath);
    const sheetName = workbook.SheetNames[0];
    
    // Get the original worksheet
    const originalWorksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON to get the range and data structure
    const data = XLSX.utils.sheet_to_json(originalWorksheet, { header: 1, raw: false, defval: '' });
    const headers = data[0];
    const rows = data.slice(1);

    // Create a new workbook
    const newWorkbook = XLSX.utils.book_new();
    
    // Create corrected data array
    const correctedData = [headers];
    
    // Track which cells were corrected for annotation
    const correctedCells = [];
    
    rows.forEach((row, rowIndex) => {
      const correctedRow = [...row];
      
      // Fill empty cells with "0" and mark them
      row.forEach((cell, colIndex) => {
        if (cell === '' || cell === null || cell === undefined) {
          correctedRow[colIndex] = '0 ★'; // ★ symbol to indicate correction
          correctedCells.push({
            row: rowIndex + 2, // +2 for header row and 1-based indexing
            col: colIndex,
            header: headers[colIndex],
            originalValue: '(empty)',
            correctedValue: '0'
          });
        }
      });
      
      correctedData.push(correctedRow);
    });

    // Create worksheet from corrected data
    const newWorksheet = XLSX.utils.aoa_to_sheet(correctedData);
    
    // Add a summary sheet with correction notes
    const summaryData = [
      ['CORRECTION SUMMARY'],
      [''],
      ['This file contains automatically corrected data'],
      ['Cells marked with ★ were empty and have been filled with "0"'],
      [''],
      ['DETAILED CORRECTIONS:'],
      ['Row', 'Column', 'Header', 'Original Value', 'Corrected Value']
    ];
    
    // Add each correction to summary
    correctedCells.forEach(cell => {
      summaryData.push([
        cell.row,
        XLSX.utils.encode_col(cell.col),
        cell.header,
        cell.originalValue,
        cell.correctedValue
      ]);
    });
    
    // Add statistics
    summaryData.push(['']);
    summaryData.push(['SUMMARY STATISTICS:']);
    summaryData.push(['Total rows processed:', rows.length]);
    summaryData.push(['Total cells corrected:', correctedCells.length]);
    summaryData.push(['Correction date:', new Date().toLocaleString()]);
    
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    
    // Add both sheets to workbook
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Corrected Data');
    XLSX.utils.book_append_sheet(newWorkbook, summarySheet, 'Correction Summary');

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const correctedFileName = `corrected_${timestamp}.xlsx`;
    const correctedFilePath = path.join(__dirname, '../temp', correctedFileName);
    
    // Ensure temp directory exists
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Save corrected file
    XLSX.writeFile(newWorkbook, correctedFilePath);
    
    console.log(`[generateCorrectedExcel] Corrected file saved: ${correctedFilePath}`);
    console.log(`[generateCorrectedExcel] Corrected ${correctedCells.length} cells`);
    
    return {
      fileName: correctedFileName,
      filePath: correctedFilePath,
      url: `/api/download-corrected/${correctedFileName}`,
      correctionCount: correctedCells.length
    };
  } catch (error) {
    console.error('Error generating corrected Excel file:', error);
    throw new Error(`Failed to generate corrected file: ${error.message}`);
  }
};
/**
 * Extract and structure Excel data for validation
 */
const extractDataForValidation = (file) => {
  try {
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    const data = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: ''
    });

    const headers = data.length > 0 ? data[0].map(h => String(h || "").trim()) : [];
    const rows = data.length > 1 ? data.slice(1) : [];

    console.log(`[extractDataForValidation] Headers found:`, headers);

    const structuredData = rows.map((row, index) => {
      const obj = { rowNumber: index + 2 }; // +2 because header is row 1
      
      headers.forEach((header, colIndex) => {
        if (header && header !== '') {
          obj[header] = String(row[colIndex] || '').trim();
        }
      });

      // Log PDF filename for debugging
      const pdfFileName = extractPdfFileName(obj);
      if (pdfFileName) {
        console.log(`[extractDataForValidation] Row ${index + 2}: PDF filename = "${pdfFileName}"`);
      }

      return obj;
    });

    return {
      headers,
      structuredData,
      originalFilePath: file.path
    };
  } catch (error) {
    throw new Error(`Failed to extract Excel data for validation: ${error.message}`);
  }
};

module.exports = {
  validateExcelData,
  generateCorrectedExcel,
  extractDataForValidation,
  extractPdfFileName, // Export for testing
  normalizeFileName    // Export for testing
};