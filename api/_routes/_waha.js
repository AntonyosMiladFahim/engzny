/**
 * api/_routes/_waha.js
 * ------------------------------------------------------------------
 * WhatsApp (WAHA) session routes. Mounted at /api/waha in api/index.js.
 *
 *   POST /api/waha/webhook  – WAHA event webhook  (PUBLIC  – HMAC-guarded)
 *   POST /api/waha/pair     – create/start session, return pairing code (auth)
 *   GET  /api/waha/status   – connection state of the caller's session   (auth)
 *
 * The webhook is intentionally unauthenticated because WAHA is an automated
 * service and does not carry a user JWT. It is secured instead by an
 * HMAC-SHA256 signature check (see wahaController.wahaWebhook).
 *
 * The pair and status routes are protected by requireAuth; the session name
 * is always derived from the authenticated user inside the controller — it is
 * NEVER taken from the request body or URL parameters.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const express = require('express');

const wahaController = require('../_controllers/_wahaController');
const requireAuth = require('../_middlewares/_authMiddleware');

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* PUBLIC — no JWT required. Security is handled inside the handler via HMAC. */
/* -------------------------------------------------------------------------- */

router.post('/webhook', wahaController.wahaWebhook);

/* -------------------------------------------------------------------------- */
/* PROTECTED — valid Bearer token required for all routes below.              */
/* -------------------------------------------------------------------------- */

router.post('/pair', requireAuth, wahaController.requestPairingCode);
router.get('/status', requireAuth, wahaController.checkStatus);

module.exports = router;
