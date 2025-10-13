const mongoose = require('mongoose');

// Main TaqeemForm schema - report_asset_file now stores the matched PDF filepath
const taqeemFormSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    default: "taqeem_form"
  },
  batch_id: {
    type: String,
    required: true
  },
  row_number: {
    type: Number,
    required: true
  },
  // Excel data fields - using snake_case
  report_title: String,
  valuation_purpose: String,
  value_premise: String,
  value_base: String,
  report_type: String,
  valuation_date: String,
  report_issuing_date: String,
  assumptions: String,
  special_assumptions: String,
  final_value: String,
  valuation_currency: String,
  // This field now stores the matched PDF filepath
  report_asset_file: String,
  client_name: String,
  telephone_number: String,
  email_address: String,
  has_other_users: String,
  report_user: String,
  valuer_name: String,
  contribution_percentage: String,
  asset_type: String,
  asset_usage_sector: String,
  inspection_date: String,
  market_approach: String,
  comparable_transactions_method: String,
  income_approach: String,
  profit_method: String,
  cost_approach: String,
  summation_method: String,
  country: String,
  region: String,
  city: String,
  latitude: String,
  longitude: String,
  certificate_number: String,
  ownership_type: String,
  street_facing_fronts: String,
  facilities: [String],
  land_area: String,
  building_area: String,
  authorized_land_cover_percentage: String,
  authorized_height: String,
  land_leased: String,
  building_status: String,
  finishing_status: String,
  furnishing_status: String,
  air_conditioning: String,
  building_type: String,
  other_features: [String],
  best_use: String,
  asset_age: String,
  street_width: String,  
  // Timestamp
  ts: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  collection: 'taqeemForms'
});

module.exports = mongoose.model('TaqeemForm', taqeemFormSchema);