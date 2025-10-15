const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const TaqeemForm = require("../../db/models/taqeemForm.model")

/**
 * Convert camelCase headers to snake_case
 * @param {string} header - The header string to convert
 * @returns {string} Snake_case version
 */

const toSnakeCase = (header) => {
  return header.replace(/([A-Z])/g, '_$1').toLowerCase();
};

/**
 * Transform data for database - store full PDF file path in report_asset_file
 */

const transformDataForDatabase = (structuredData, batchId) => {
  return structuredData.map(record => {
    const transformedRecord = {
      type: "taqeem_form",
      batch_id: batchId,
      row_number: record.rowNumber,
      ts: new Date()
    };

    // Convert all Excel headers to snake_case and add to record
    Object.keys(record).forEach(key => {
      if (key !== 'rowNumber' && key !== 'pdfFile' && key !== 'report_asset_file') {
        const snakeKey = toSnakeCase(key);
        transformedRecord[snakeKey] = String(record[key] || '');
      }
    });

    // Store the FULL PDF file path in report_asset_file field
    if (record.pdfFile && record.pdfFile.exists) {
      // Store the complete absolute file path
      transformedRecord.report_asset_file = path.resolve(record.pdfFile.storedPath);
    } else {
      // Keep original filename if no PDF matched, or set to empty
      transformedRecord.report_asset_file = record.report_asset_file || '';
    }

    return transformedRecord;
  });
};

/**
 * Save data to MongoDB
 */
const saveToDatabase = async (data) => {
  try {
    const inserted = await TaqeemForm.insertMany(data);
    console.log(`✅ Inserted ${inserted.length} records into database`);
    return inserted;
  } catch (error) {
    console.error('❌ Database insertion error:', error);
    throw new Error(`Failed to save to database: ${error.message}`);
  }
};

/**
 * Extract data from Excel file with PDF handling and save to database
 */
const extractExcelData = async (file, pdfFiles = []) => {
  try {
    console.log(`[extractExcelData] Processing Excel file: ${file.originalname}`);
    console.log(`[extractExcelData] PDF files received: ${pdfFiles.length}`);

    // Read the Excel file
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet) {
      throw new Error("No worksheet found in Excel file");
    }

    // Convert to JSON with headers
    const data = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: ''
    });

    // Extract headers (first row) and data (remaining rows)
    const headers = data.length > 0 ? data[0].map(h => String(h || "").trim()) : [];
    const rows = data.length > 1 ? data.slice(1) : [];

    console.log(`[extractExcelData] Found ${headers.length} headers and ${rows.length} data rows`);

    // Create PDF lookup map using original filenames
    const pdfLookup = {};
    pdfFiles.forEach(pdfFile => {
      const originalName = pdfFile.originalname;
      // Store the full file path
      pdfLookup[originalName] = path.resolve(pdfFile.path);
    });

    // Transform into structured data
    const structuredData = rows.map((row, index) => {
      const obj = { rowNumber: index + 2 };
      
      // Map all headers to object properties
      headers.forEach((header, colIndex) => {
        if (header && header !== '') {
          obj[header] = String(row[colIndex] || '').trim();
        }
      });
      
      // Find matching PDF using report_asset_file from Excel
      const pdfFileName = obj["Report Asset File"] || obj["reportAssetFile"] || obj["report_asset_file"];
      const matchedPdfPath = pdfFileName ? pdfLookup[pdfFileName] : null;
      
      // Add PDF info to the record
      obj.pdfFile = {
        exists: !!matchedPdfPath,
        storedPath: matchedPdfPath || null,
        expectedFileName: pdfFileName || null
      };

      return obj;
    });

    // Generate batch ID
    const batchId = uuidv4();

    // Transform data for database
    const dataForDatabase = transformDataForDatabase(structuredData, batchId);
    console.log(`[extractExcelData] Transformed ${dataForDatabase.length} records for database`);
    
    // Log some sample file paths for verification
    const sampleRecords = dataForDatabase.filter(record => record.report_asset_file);
    if (sampleRecords.length > 0) {
      console.log(`[extractExcelData] Sample PDF file paths stored:`);
      sampleRecords.slice(0, 3).forEach((record, index) => {
        console.log(`  ${index + 1}. ${record.report_asset_file}`);
      });
    }

    // Save to database
    const insertedRecords = await saveToDatabase(dataForDatabase);

    // Clean up Excel file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return {
      success: true,
      data: {
        fileName: file.originalname,
        batchId: batchId,
        headers: headers,
        totalRows: structuredData.length,
        insertedCount: insertedRecords.length,
        databaseIds: insertedRecords.map(r => r._id),
        pdfStats: {
          totalPdfs: pdfFiles.length,
          matchedPdfs: structuredData.filter(r => r.pdfFile.exists).length,
          unmatchedPdfs: structuredData.filter(r => !r.pdfFile.exists && r.pdfFile.expectedFileName).length
        },
        // Include file path info in response for debugging
        filePathInfo: {
          storageType: "full_absolute_paths",
          samplePaths: sampleRecords.slice(0, 3).map(r => r.report_asset_file)
        }
      }
    };

  } catch (error) {
    // Clean up files if they exist
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    
    console.error('[extractExcelData] Error:', error);
    throw new Error(`Failed to extract Excel data: ${error.message}`);
  }
};

/**
 * Controller function for Excel extraction with PDF support
 */
const excelExtractController = async (req, res) => {
  try {
    if (!req.files) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const excelFile = req.files.excelFile ? req.files.excelFile[0] : null;
    const pdfFiles = req.files.pdfFiles || [];

    if (!excelFile) {
      return res.status(400).json({
        success: false,
        message: 'No Excel file uploaded'
      });
    }

    console.log(`[excelExtractController] Processing: ${excelFile.originalname} with ${pdfFiles.length} PDFs`);

    const result = await extractExcelData(excelFile, pdfFiles);
    
    res.json({
      success: true,
      message: `Excel data extracted and saved successfully. Inserted ${result.data.insertedCount} records.`,
      data: result.data
    });

  } catch (error) {
    console.error('[excelExtractController] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extract Excel data',
      error: error.message
    });
  }
};

module.exports = {
  extractExcelData,
  excelExtractController
};