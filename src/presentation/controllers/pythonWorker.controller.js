const pythonWorkerService = require('../../services/pythonWorkerService');

const testPing = async (req, res) => {
  try {
    const result = await pythonWorkerService.ping();
    res.json({
      success: true,
      message: 'Python worker ping successful',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const testHello = async (req, res) => {
  try {
    const result = await pythonWorkerService.hello();
    res.json({
      success: true,
      message: 'Python worker hello test',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const testSimulateWork = async (req, res) => {
  try {
    const result = await pythonWorkerService.simulateWork();
    res.json({
      success: true,
      message: 'Work simulation completed',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const getWorkerStatus = async (req, res) => {
  try {
    const status = pythonWorkerService.getStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const restartWorker = async (req, res) => {
  try {
    await pythonWorkerService.closeWorker();
    pythonWorkerService.startWorker();
    
    res.json({
      success: true,
      message: 'Worker restarted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  testPing,
  testHello,
  testSimulateWork,
  getWorkerStatus,
  restartWorker
};