/**
 * api/_routes/_ai.js
 * ------------------------------------------------------------------
 * AI summarisation routes. Mounted at /api/ai in api/index.js.
 *
 *   POST /api/ai/webhook  – WAHA webhook (unauthenticated, secret-guarded)
 *   POST /api/ai/upload   – authenticated front-end upload
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const express = require('express');

const aiController = require('../_controllers/_aiController');
const requireAuth = require('../_middlewares/_authMiddleware');

const router = express.Router();

/**
 * POST /api/ai/webhook
 *
 * Called by WAHA whenever a message arrives on any session.
 * This route is intentionally unauthenticated — WAHA does not send a JWT.
 * The controller validates the session name (== userId) itself.
 *
 * Optional webhook secret: set WAHA_WEBHOOK_SECRET in env. If set, every
 * request must include the header  X-Webhook-Secret: <value>.
 */
router.post('/webhook', (req, res, next) => {
    const secret = process.env.WAHA_WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-secret'] !== secret) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    return next();
}, aiController.wahaWebhook);

/**
 * POST /api/ai/upload
 *
 * Authenticated upload from the PWA (Web Share Target / file handler).
 * Body: { audioBase64: string, mimeType?: string, folderId?: string }
 */
router.post('/upload', requireAuth, aiController.uploadVoiceNote);

module.exports = router;
