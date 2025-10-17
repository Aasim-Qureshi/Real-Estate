const TaqeemForm = require("../../db/models/taqeemForm.model");

const getAllReportsController = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      batchId,
      search,
      sortBy = 'ts',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (batchId) {
      filter.batch_id = batchId;
    }

    if (search) {
      filter.$or = [
        { report_asset_file: { $regex: search, $options: 'i' } },
        { type: { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const [forms, totalCount] = await Promise.all([
      TaqeemForm.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(), // Convert to plain JS objects for better performance
      
      TaqeemForm.countDocuments(filter)
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNext = pageNum < totalPages;
    const hasPrev = pageNum > 1;

    res.json({
      success: true,
      data: {
        forms,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount,
          hasNext,
          hasPrev,
          limit: limitNum
        }
      },
      message: `Retrieved ${forms.length} of ${totalCount} forms`
    });

  } catch (error) {
    console.error('[getAllReportsController] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports',
      error: error.message
    });
  }
};

/**
 * Simple endpoint to get all forms without pagination (for smaller datasets)
 */
const getAllReportsSimpleController = async (req, res) => {
  try {
    const forms = await TaqeemForm.find({})
      .sort({ ts: -1 })
      .lean();

    res.json({
      success: true,
      data: forms,
      count: forms.length,
      message: `Retrieved ${forms.length} forms`
    });

  } catch (error) {
    console.error('[getAllReportsSimpleController] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports',
      error: error.message
    });
  }
};

/**
 * Get form by ID
 */
const getReportByIdController = async (req, res) => {
  try {
    const { id } = req.params;

    const form = await TaqeemForm.findById(id).lean();

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    res.json({
      success: true,
      data: form
    });

  } catch (error) {
    console.error('[getReportByIdController] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch form',
      error: error.message
    });
  }
};

/**
 * Get batch statistics
 */
/**
 * Get batch statistics with detailed report info
 */
const getBatchStatsController = async (req, res) => {
  try {
    const batchStats = await TaqeemForm.aggregate([
      {
        $group: {
          _id: '$batch_id',
          count: { $sum: 1 },
          submittedCount: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $ifNull: ['$form_id', false] },
                    { $ne: ['$form_id', ''] }
                  ]
                },
                1,
                0
              ]
            }
          },
          latestUpload: { $max: '$ts' },
          earliestUpload: { $min: '$ts' },
          reportIds: { $push: '$_id' },
          // Optional: Include additional report information
          reports: {
            $push: {
              id: '$_id',
              form_id: '$form_id',
              report_asset_file: '$report_asset_file',
              type: '$type',
              ts: '$ts'
            }
          }
        }
      },
      {
        $addFields: {
          submissionStatus: {
            $switch: {
              branches: [
                {
                  case: { $eq: ['$submittedCount', 0] },
                  then: 'pending'
                },
                {
                  case: { $eq: ['$submittedCount', '$count'] },
                  then: 'completed'
                },
                {
                  case: { $and: [{ $gt: ['$submittedCount', 0] }, { $lt: ['$submittedCount', '$count'] }] },
                  then: 'partial'
                }
              ],
              default: 'pending'
            }
          }
        }
      },
      {
        $sort: { latestUpload: -1 }
      }
    ]);

    res.json({
      success: true,
      data: batchStats,
      message: `Found ${batchStats.length} batches`
    });

  } catch (error) {
    console.error('[getBatchStatsController] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch batch statistics',
      error: error.message
    });
  }
};

module.exports = {
  getAllReportsController,
  getAllReportsSimpleController,
  getReportByIdController,
  getBatchStatsController
};