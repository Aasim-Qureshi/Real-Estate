const pythonWorkerService = require('../../services/pythonWorkerService');

const login = async (req, res) => {
  try {
    const { email, password, recordId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    console.log(`[AUTH] Login attempt for: ${email}`);

    const result = await pythonWorkerService.login(email, password, recordId);

    if (result.status === 'OTP_REQUIRED') {
      return res.json({
        success: true,
        requiresOtp: true,
        message: 'OTP required to complete login',
        data: result
      });
    }

    if (result.status === 'LOGIN_SUCCESS') {
      return res.json({
        success: true,
        message: 'Login successful',
        data: result
      });
    }

    // Handle other statuses
    if (result.status === 'NOT_FOUND') {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        recoverable: result.recoverable
      });
    }

    return res.status(400).json({
      success: false,
      error: result.error || 'Login failed',
      data: result
    });

  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const submitOtp = async (req, res) => {
  try {
    const { otp, recordId } = req.body;

    if (!otp) {
      return res.status(400).json({
        success: false,
        error: 'OTP is required'
      });
    }

    console.log(`[AUTH] OTP submission attempt`);

    const result = await pythonWorkerService.submitOtp(otp, recordId);

    if (result.status === 'SUCCESS') {
      return res.json({
        success: true,
        message: 'OTP verified successfully',
        data: result
      });
    }

    if (result.status === 'OTP_FAILED') {
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP',
        recoverable: result.recoverable,
        data: result
      });
    }

    return res.status(400).json({
      success: false,
      error: result.error || 'OTP verification failed',
      data: result
    });

  } catch (error) {
    console.error('[AUTH] OTP error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const logout = async (req, res) => {
  try {
    const result = await pythonWorkerService.closeBrowser();

    res.json({
      success: true,
      message: 'Logged out successfully',
      data: result
    });

  } catch (error) {
    console.error('[AUTH] Logout error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const getAuthStatus = async (req, res) => {
  try {
    const status = pythonWorkerService.getStatus();
    
    // You might want to add additional auth-specific status checks here
    res.json({
      success: true,
      data: {
        worker: status,
        authenticated: status.ready // This is a simple check - you might want more sophisticated auth state tracking
      }
    });

  } catch (error) {
    console.error('[AUTH] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  login,
  submitOtp,
  logout,
  getAuthStatus
};