/**
 * api/_middlewares/_authMiddleware.js
 * ------------------------------------------------------------------
 * Express middleware that gates a route behind a valid Bearer JWT.
 *
 * Flow:
 *   1. Extract `Authorization: Bearer <token>`. Anything else → 401.
 *   2. Cryptographically verify the token (signature, exp, nbf, iss, aud,
 *      algorithm pin) via _config/_jwt.js. Failure → 401.
 *   3. Confirm the `sub` claim is a well-formed ObjectId. Failure → 401.
 *   4. Load the user from MongoDB. A token for a deleted account → 401.
 *      This DB round-trip costs a few ms but means deleting a user
 *      immediately revokes all their tokens – important for a multi-tenant
 *      SaaS where an offboarded tenant must lose access at once.
 *   5. Attach the user to `req.user` and call `next()`.
 *
 * Every rejection returns the same generic 401 body. We distinguish only the
 * *expired* case, because clients need that signal to prompt a re-login.
 * Leaking "bad signature" vs "bad issuer" helps attackers, not users.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const mongoose = require('mongoose');

const connectDB = require('../_config/_db');
const User = require('../_models/_User');
const { verifyToken } = require('../_config/_jwt');

/** Generic messages – keep them boring on purpose. */
const MSG_UNAUTHORIZED = 'Authentication required';
const MSG_EXPIRED = 'Session expired, please log in again';

/**
 * Pull the raw token out of the Authorization header.
 *
 * Accepts exactly `Bearer <token>` (case-insensitive scheme, single space,
 * no trailing garbage). Returns `null` for anything else so the caller can
 * reject without ever passing junk to the JWT library.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
    const header = req.headers && (req.headers.authorization || req.headers.Authorization);

    if (typeof header !== 'string') {
        return null;
    }

    const parts = header.trim().split(/\s+/);

    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
        return null;
    }

    return parts[1];
}

/**
 * The middleware itself. Usage:
 *
 *   const requireAuth = require('../_middlewares/_authMiddleware');
 *   router.get('/me', requireAuth, authController.me);
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function requireAuth(req, res, next) {
    const token = extractBearerToken(req);

    if (!token) {
        return res.status(401).json({ message: MSG_UNAUTHORIZED });
    }

    let payload;
    try {
        payload = verifyToken(token);
    } catch (err) {
        if (err && err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: MSG_EXPIRED });
        }
        // JsonWebTokenError (bad signature / alg / iss / aud / malformed),
        // NotBeforeError, or a misconfigured secret – all end the same way.
        return res.status(401).json({ message: MSG_UNAUTHORIZED });
    }

    // Defensive: a token we signed always has a valid ObjectId `sub`, but a
    // token forged with a leaked secret might not. Never hand arbitrary
    // strings to Mongoose.
    if (!payload || typeof payload.sub !== 'string' || !mongoose.isValidObjectId(payload.sub)) {
        return res.status(401).json({ message: MSG_UNAUTHORIZED });
    }

    try {
        await connectDB();

        // Only project the fields downstream handlers need. `password` is
        // already `select: false`, but an explicit projection documents intent.
        const user = await User.findById(payload.sub, 'email wahaSessionId createdAt updatedAt');

        if (!user) {
            // Valid signature but the account no longer exists → revoked.
            return res.status(401).json({ message: MSG_UNAUTHORIZED });
        }

        req.user = user;
        req.auth = { userId: payload.sub, tokenExp: payload.exp };

        return next();
    } catch (err) {
        // A DB outage is *our* fault, not the client's – do not mask it as 401.
        console.error('[auth] middleware failed:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = requireAuth;
// Named export for unit tests.
module.exports.extractBearerToken = extractBearerToken;
