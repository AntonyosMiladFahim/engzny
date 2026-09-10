const express = require('express');
const router = express.Router();

const requireAuth = require('../_middlewares/_authMiddleware');
const whatsappController = require('../_controllers/_whatsappController');

// All routes here should be protected by the auth middleware
// so that req.user.id is securely populated for the controller.

// POST /api/whatsapp/link-device
router.post('/link-device', requireAuth, whatsappController.linkDevice);

// GET /api/whatsapp/status
router.get('/status', requireAuth, whatsappController.checkStatus);

module.exports = router;
