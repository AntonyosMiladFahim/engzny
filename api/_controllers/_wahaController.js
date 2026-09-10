/**
 * api/_controllers/_wahaController.js
 * ------------------------------------------------------------------
 * Per-tenant WhatsApp session management on top of WAHA.
 *
 * THE ISOLATION RULE
 * ------------------
 * Every WAHA session is named after the authenticated user's id
 * (`req.user.id`). That id comes from the verified JWT + database lookup in
 * _authMiddleware.js – it is NEVER read from the URL, query string or body.
 *
 * Consequently:
 *   - User A cannot request User B's QR code or connection status, because
 *     there is no input through which A could name B's session.
 *   - Any `session`, `name` or `id` field a client sends is silently ignored.
 *
 * If you ever find yourself adding `req.params.session` to this file, stop:
 * that is the moment tenant isolation breaks.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const User = require('../_models/_User');
const connectDB = require('../_config/_db');
const waha = require('../_config/_waha');

const { SessionStatus, WahaError } = waha;

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

/**
 * Derive the WAHA session name for the authenticated user.
 *
 * `req.user` is a Mongoose document attached by requireAuth, so `.id` is the
 * string form of `_id`. We fall back to `_id` for plain objects (tests, lean
 * queries). The result is a 24-char hex string – valid as a WAHA session name.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function sessionNameFor(req) {
    const user = req.user;
    const id = user && (user.id || user._id);
    if (!id) {
        // requireAuth guarantees req.user; reaching here is a programming error.
        throw new Error('[waha] sessionNameFor called without an authenticated user');
    }
    return String(id);
}

/**
 * Map a raw WAHA session object to the shape we expose to clients. We
 * deliberately whitelist fields – WAHA's payload includes config and engine
 * internals that are none of the browser's business.
 *
 * @param {string} sessionName
 * @param {object|null} session raw WAHA session or null if absent
 */
function toStatusResponse(sessionName, session) {
    const status = session ? session.status : 'NOT_CREATED';
    return {
        session: sessionName,
        status,
        connected: status === SessionStatus.WORKING,
        // `me` is present once WORKING: { id: '<phone>@c.us', pushName }
        me: session && session.me
            ? { id: session.me.id, pushName: session.me.pushName }
            : null,
    };
}

/**
 * Translate a WAHA failure into an HTTP response. Upstream failures are *our*
 * dependency's fault, so 502 Bad Gateway; anything else is a plain 500.
 */
function handleError(res, err, context) {
    console.error(`[waha] ${context} failed:`, err.message);
    if (err instanceof WahaError) {
        return res.status(502).json({ message: 'WhatsApp service is unavailable, please try again' });
    }
    return res.status(500).json({ message: 'Internal server error' });
}

/**
 * Remember which WAHA session belongs to the user. Idempotent; failures here
 * are logged but do not fail the request, because the session already exists
 * on WAHA and the name is deterministic anyway.
 */
async function rememberSession(userId, sessionName) {
    try {
        await connectDB();
        await User.findByIdAndUpdate(userId, { wahaSessionId: sessionName });
    } catch (err) {
        console.error('[waha] could not persist wahaSessionId:', err.message);
    }
}

/* -------------------------------------------------------------------------- */
/*                                  Handlers                                  */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/waha/pair   (requireAuth)
 * Body: { phoneNumber: "1234567890" }
 *
 * Ensures the caller's session exists and is started, then returns the pairing code.
 * Response variants:
 *
 *   200 { session, status: 'SCAN_QR_CODE', code: 'ABCDEFGH' }
 *   200 { session, status: 'WORKING', connected: true }      – already linked
 *   202 { session, status: 'STARTING' | ... }                 – not ready yet, retry
 *   400 { message }                                           – invalid phone number
 *   502 { message }                                           – WAHA unreachable
 */
async function requestPairingCode(req, res) {
    const sessionName = sessionNameFor(req);
    const { phoneNumber } = req.body;

    if (!phoneNumber || typeof phoneNumber !== 'string') {
        return res.status(400).json({ message: 'Phone number is required' });
    }

    try {
        // 1. Find the caller's session, creating/starting it as needed.
        let session = await waha.getSession(sessionName);

        if (!session) {
            session = await waha.createSession(sessionName);
        } else if (
            session.status === SessionStatus.STOPPED ||
            session.status === SessionStatus.FAILED
        ) {
            session = await waha.startSession(sessionName);
        }

        // 2. Link the session to the user record (fire-and-forget semantics).
        await rememberSession(sessionName, sessionName);

        // 3. Already paired – nothing to pair.
        if (session.status === SessionStatus.WORKING) {
            return res.status(200).json(toStatusResponse(sessionName, session));
        }

        // 4. Engine still booting – tell the client to poll again shortly.
        if (session.status !== SessionStatus.SCAN_QR_CODE) {
            return res.status(202).json({
                ...toStatusResponse(sessionName, session),
                retryAfterMs: 2000,
            });
        }

        // 5. Ready to pair – fetch and return the pairing code for *this* session only.
        // Clean the phone number to only contain digits.
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        const response = await waha.requestPairingCode(sessionName, cleanPhone);

        return res.status(200).json({
            ...toStatusResponse(sessionName, session),
            code: response.code,
        });
    } catch (err) {
        return handleError(res, err, 'requestPairingCode');
    }
}

/**
 * GET /api/waha/status   (requireAuth)
 *
 *   200 { session, status, connected, me }
 *   502 { message }
 *
 * `status` is 'NOT_CREATED' when the user has never requested a QR.
 */
async function checkStatus(req, res) {
    const sessionName = sessionNameFor(req);

    try {
        const session = await waha.getSession(sessionName);
        return res.status(200).json(toStatusResponse(sessionName, session));
    } catch (err) {
        return handleError(res, err, 'checkStatus');
    }
}

module.exports = {
    requestPairingCode,
    checkStatus,
    // Exported for unit tests.
    _internal: { sessionNameFor, toStatusResponse },
};
