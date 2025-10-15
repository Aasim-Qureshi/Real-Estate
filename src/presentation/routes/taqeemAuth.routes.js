const express = require('express');
const router = express.Router();
const {
  login,
  submitOtp,
  logout,
  getAuthStatus
} = require('../controllers/taqeemAuth.controller');

// Authentication routes
router.post('/login', login);
router.post('/otp', submitOtp);
router.post('/logout', logout);
router.get('/status', getAuthStatus);

module.exports = router;