/**
 * api/_routes/_auth.js
 * ------------------------------------------------------------------
 * Route table for authentication. Mounted at /api/auth in api/index.js.
 *
 *   POST /api/auth/register  – create an account, returns { token, user }
 *   POST /api/auth/login     – exchange credentials for a token
 *   GET  /api/auth/me        – return the current user (requires Bearer token)
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route;
 * only api/index.js is a real serverless entry point.
 * ------------------------------------------------------------------
 */

const express = require('express');

const authController = require('../_controllers/_authController');
const requireAuth = require('../_middlewares/_authMiddleware');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', requireAuth, authController.me);

module.exports = router;
