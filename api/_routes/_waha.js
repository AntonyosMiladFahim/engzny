/**
 * api/_routes/_waha.js
 * ------------------------------------------------------------------
 * WhatsApp (WAHA) session routes. Mounted at /api/waha in api/index.js.
 *
 *   POST /api/waha/pair   – create/start the caller's session, return pairing code
 *   GET /api/waha/status  – connection state of the caller's session
 *
 * Both routes require a Bearer token. Note there is deliberately NO
 * `/:session` parameter anywhere: the session is always derived from the
 * authenticated user inside the controller.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const express = require('express');

const wahaController = require('../_controllers/_wahaController');
const requireAuth = require('../_middlewares/_authMiddleware');

const router = express.Router();

router.use(requireAuth);

router.post('/pair', wahaController.requestPairingCode);
router.get('/status', wahaController.checkStatus);

module.exports = router;
