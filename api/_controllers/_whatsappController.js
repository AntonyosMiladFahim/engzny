const axios = require('axios');
const User = require('../_models/_User');
const connectDB = require('../_config/_db');

// Setup Axios instance for WAHA calls with required headers
const wahaApi = axios.create({
  baseURL: process.env.WAHA_API_URL,
  headers: {
    'X-Api-Key': process.env.WAHA_API_KEY,
    'Content-Type': 'application/json'
  }
});

/**
 * Endpoint 1: POST /api/whatsapp/link-device
 * Generates a pairing code via WAHA for the frontend.
 */
exports.linkDevice = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const sessionId = String(req.user.id);

    if (!phoneNumber) {
      return res.status(400).json({ message: 'Phone number is required.' });
    }

    // Step 1: Create Session
    try {
      await wahaApi.post('/api/sessions/', {
        name: sessionId,
        config: {}
      });
    } catch (error) {
      // Catch 409 errors gracefully if the session already exists
      if (error.response && error.response.status !== 409) {
        throw error;
      }
    }

    // Step 2: Start Engine
    try {
      await wahaApi.post(`/api/sessions/${sessionId}/start`);
    } catch (error) {
      // Session might already be running, log it but don't fail immediately
      console.warn(`[whatsappController] Session start warning:`, error.message);
    }

    // Step 3: Request Code
    try {
      const response = await wahaApi.post(`/api/sessions/${sessionId}/auth/request-code`, {
        phoneNumber: phoneNumber
      });

      // Extract the pairing code (WAHA usually returns it as response.data.code)
      const code = response.data.code || response.data.pairingCode;
      
      if (!code) {
        throw new Error('Failed to extract pairing code from WAHA response.');
      }

      // Return it cleanly formatted (the frontend can handle the dash formatting)
      return res.status(200).json({ pairingCode: code });

    } catch (error) {
      if (error.response && error.response.status === 429) {
        return res.status(429).json({ 
          message: 'Too many requests. Please wait a moment before requesting another code.' 
        });
      }
      throw error; // Let outer try/catch handle other errors
    }

  } catch (error) {
    console.error('[whatsappController] linkDevice failed:', error.message);
    return res.status(500).json({ message: 'Internal server error while linking device.' });
  }
};

/**
 * Endpoint 2: GET /api/whatsapp/status
 * Polls WAHA to check if the session is successfully connected ('WORKING').
 */
exports.checkStatus = async (req, res) => {
  try {
    const sessionId = String(req.user.id);

    // Step 1: Check Status (WAHA endpoint is /api/sessions/:id)
    let response;
    try {
      response = await wahaApi.get(`/api/sessions/${sessionId}`);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return res.status(200).json({ connected: false, status: 'NOT_CREATED' });
      }
      throw err;
    }

    const status = response.data.status;

    // Step 2: Evaluate & Update DB
    if (status === 'WORKING') {
      await connectDB();
      await User.findByIdAndUpdate(sessionId, { whatsappConnected: true });
      return res.status(200).json({ connected: true });
    }

    // Not yet working
    return res.status(200).json({ connected: false, status });

  } catch (error) {
    console.error('[whatsappController] checkStatus failed:', error.message);
    return res.status(500).json({ message: 'Internal server error while checking status.' });
  }
};
