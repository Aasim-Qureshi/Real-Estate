const express = require('express');
const router = express.Router();
const {
  testPing,
  testHello,
  testSimulateWork,
  getWorkerStatus,
  restartWorker
} = require('../controllers/pythonWorker.controller');

// Test endpoints for Python worker
router.get('/ping', testPing);
router.get('/hello', testHello);
router.post('/simulate-work', testSimulateWork);
router.get('/status', getWorkerStatus);
router.post('/restart', restartWorker);

module.exports = router;