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

const crypto = require('crypto');

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

/**
 * POST /api/waha/webhook  (PUBLIC – HMAC-SHA256 guarded)
 *
 * WAHA calls this endpoint for every WhatsApp event on every session managed
 * by this server. The handler contract, in strict order:
 *
 *  1. Respond 200 OK IMMEDIATELY — before any async work.
 *     WAHA treats any non-2xx (or a slow response) as a delivery failure and
 *     retries up to 15 times. We must acknowledge receipt at once.
 *
 *  2. Verify the HMAC-SHA256 signature when WAHA_WEBHOOK_HMAC_KEY is set.
 *     WAHA signs the raw request body with the shared key and places the hex
 *     digest in the  x-webhook-hmac  header. If the digests do not match we
 *     log a warning and drop the event silently (the 200 has already gone out,
 *     so WAHA will not retry — which is the desired behaviour for a forged
 *     payload).
 *
 *  3. Delegate voice-note processing to the AI controller asynchronously
 *     (fire-and-forget after the response). Any error there is logged but does
 *     not affect the acknowledged 200.
 *
 * Security note: when WAHA_WEBHOOK_HMAC_KEY is absent (local dev without a
 * shared secret) the signature check is skipped so developers can test with
 * plain curl / Postman without configuring the env var.
 */
async function wahaWebhook(req, res) {
    // ── Step 1: respond immediately so WAHA stops waiting ─────────────────
    res.status(200).send('OK');

    // ── Step 2: log the incoming event for Vercel log visibility ──────────
    const { event, session } = req.body || {};
    console.log('Webhook Event Received:', event, '| session:', session);

    // ── Step 3: HMAC-SHA256 signature verification ─────────────────────────
    const hmacKey = process.env.WAHA_WEBHOOK_HMAC_KEY;
    if (hmacKey) {
        const incomingSignature = req.headers['x-webhook-hmac'];
        if (!incomingSignature) {
            console.warn('[waha/webhook] HMAC key configured but x-webhook-hmac header missing — dropping event');
            return;
        }

        // req.rawBody is the raw Buffer set by the express.json verify callback
        // in api/index.js. Using the raw bytes guarantees the digest matches
        // exactly what WAHA signed, regardless of JSON key ordering.
        const rawBody = req.rawBody;
        if (!rawBody) {
            console.warn('[waha/webhook] req.rawBody not available — cannot verify HMAC, dropping event');
            return;
        }

        const expectedSignature = crypto
            .createHmac('sha256', hmacKey)
            .update(rawBody)
            .digest('hex');

        // Use timingSafeEqual to prevent timing-based signature oracle attacks.
        const incoming = Buffer.from(incomingSignature, 'hex');
        const expected = Buffer.from(expectedSignature, 'hex');

        const signaturesMatch =
            incoming.length === expected.length &&
            crypto.timingSafeEqual(incoming, expected);

        if (!signaturesMatch) {
            console.warn('[waha/webhook] HMAC signature mismatch — dropping event (possible forged payload)');
            return;
        }
    }

    // ── Step 4: delegate payload processing (async, fire-and-forget) ──────
    // Only handle 'message' events that carry media (voice notes).
    if (event !== 'message') return;

    const payload = req.body?.payload;
    if (!payload?.hasMedia) return;

    // Process asynchronously — do NOT await here; the response is already sent.
    setImmediate(async () => {
        try {
            const { wahaWebhook: processWebhook } = require('./_aiController');
            // Re-invoke the AI controller's webhook processor with a synthetic
            // request / response pair so we reuse all the AI + DB logic there.
            await processWebhook(
                { body: req.body },
                // Provide a no-op response shim — the real response is already sent.
                { status: () => ({ send: () => {} }) }
            );
        } catch (err) {
            console.error('[waha/webhook] async processing failed:', err.message);
        }
    });
}

/**
 * GET /api/waha/chats   (requireAuth)
 *
 * Returns the active WhatsApp chats for the authenticated user's session,
 * projected to the minimal shape the share-routing modal needs:
 *
 *   { id, name, picture, lastMessage: { body, timestamp } | null }
 *
 * Design decisions:
 *   - Empty array (not an error) when the session does not exist or is not yet
 *     WORKING. The modal renders a "Link WhatsApp first" callout in that case.
 *   - `picture` may be null even for existing chats (privacy settings); the UI
 *     falls back to an initials badge.
 *   - We limit to 50 rows by default (via the helper) to bound lambda memory.
 *
 * Response:
 *   200 { chats: [...], connected: true }
 *   200 { chats: [],   connected: false }   – session absent / not WORKING
 *   502 { message }                          – WAHA unreachable
 */
async function getChats(req, res) {
    const sessionName = sessionNameFor(req);

    try {
        // Fast-path: if the session is not WORKING the chats endpoint would
        // return an empty list anyway — we skip the second round-trip.
        const session = await waha.getSession(sessionName);
        if (!session || session.status !== SessionStatus.WORKING) {
            return res.status(200).json({ chats: [], connected: false });
        }

        const raw = await waha.getChats(sessionName);

        const chats = (Array.isArray(raw) ? raw : []).map((c) => ({
            // Stable grouping key — same id format as senderId on VoiceNote.
            id: c.id?._serialized ?? c.id ?? null,
            name: c.name ?? c.displayName ?? null,
            // WAHA places the avatar URL in `picture`.
            picture: c.picture ?? null,
            lastMessage: c.lastMessage
                ? {
                      body: typeof c.lastMessage.body === 'string'
                          ? c.lastMessage.body.slice(0, 120)
                          : null,
                      timestamp: c.lastMessage.timestamp ?? null,
                  }
                : null,
        })).filter((c) => c.id);

        return res.status(200).json({ chats, connected: true });
    } catch (err) {
        return handleError(res, err, 'getChats');
    }
}

module.exports = {
    wahaWebhook,
    requestPairingCode,
    checkStatus,
    getChats,
    // Exported for unit tests.
    _internal: { sessionNameFor, toStatusResponse },
};
