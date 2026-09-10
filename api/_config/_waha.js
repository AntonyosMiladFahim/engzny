/**
 * api/_config/_waha.js
 * ------------------------------------------------------------------
 * Thin HTTP client for the WAHA (WhatsApp HTTP API) server.
 *
 * WHY A SEPARATE MODULE
 * ---------------------
 * The controller should reason about *users* and *sessions*, not about URLs,
 * headers and status codes. Concentrating every WAHA endpoint here means:
 *   - one place to update when WAHA changes its API,
 *   - tests can point WAHA_URL at a fake server and observe every call,
 *   - the API key is attached in exactly one place and can never be forgotten.
 *
 * ISOLATION CONTRACT
 * ------------------
 * Every function takes an explicit `sessionName`. Callers are responsible for
 * deriving it from the authenticated user (see _wahaController.js). This
 * module never reads request data, so it cannot be tricked into addressing
 * another tenant's session.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const axios = require('axios');

/**
 * WAHA session lifecycle states (subset we act on).
 * https://waha.devlike.pro/docs/how-to/sessions/
 */
const SessionStatus = Object.freeze({
    STOPPED: 'STOPPED',
    STARTING: 'STARTING',
    SCAN_QR_CODE: 'SCAN_QR_CODE',
    WORKING: 'WORKING',
    FAILED: 'FAILED',
});

/** Raised for any non-2xx / network failure talking to WAHA. */
class WahaError extends Error {
    /**
     * @param {string} message
     * @param {number} [status] upstream HTTP status, if any
     * @param {unknown} [body]  upstream response body, if any
     */
    constructor(message, status, body) {
        super(message);
        this.name = 'WahaError';
        this.status = status;
        this.body = body;
    }
}

/**
 * Build an axios instance for the configured WAHA server.
 *
 * Resolved per call (not at module load) so tests can set WAHA_URL after
 * requiring this module, and so a misconfigured env fails at request time
 * with a clear message instead of crashing the whole lambda on import.
 */
function client() {
    const baseURL = process.env.WAHA_URL;
    if (!baseURL) {
        throw new WahaError('[waha] WAHA_URL is not defined');
    }

    const headers = { Accept: 'application/json' };
    // WAHA_API_KEY is optional for local docker setups but mandatory in prod.
    if (process.env.WAHA_API_KEY) {
        headers['X-Api-Key'] = process.env.WAHA_API_KEY;
    }

    return axios.create({
        baseURL,
        headers,
        timeout: Number.parseInt(process.env.WAHA_TIMEOUT_MS, 10) || 30000,
        // We inspect status codes ourselves (404 is meaningful for "no session").
        validateStatus: () => true,
    });
}

/**
 * Convert an axios response into data or a WahaError.
 * @param {import('axios').AxiosResponse} res
 * @param {number[]} [okStatuses] statuses considered successful
 */
function unwrap(res, okStatuses = [200, 201]) {
    if (okStatuses.includes(res.status)) {
        return res.data;
    }
    throw new WahaError(
        `[waha] ${res.config.method.toUpperCase()} ${res.config.url} → ${res.status}`,
        res.status,
        res.data
    );
}

/**
 * Wrap network-level failures (ECONNREFUSED, timeout) as WahaError too, so
 * the controller has a single error type to handle.
 */
async function call(fn) {
    try {
        return await fn(client());
    } catch (err) {
        if (err instanceof WahaError) throw err;
        throw new WahaError(`[waha] request failed: ${err.message}`);
    }
}

/**
 * GET /api/sessions/{name}
 * @returns {Promise<object|null>} session info, or null if it does not exist
 */
async function getSession(sessionName) {
    return call(async (http) => {
        const res = await http.get(`/api/sessions/${encodeURIComponent(sessionName)}`);
        // Treat any non-2xx response (404, 400, etc) as "session does not exist".
        // If it's a genuine error (like 401 Unauthorized), createSession will catch it properly.
        if (res.status < 200 || res.status >= 300) return null;
        return res.data;
    });
}

/**
 * POST /api/sessions  – create a session and start it immediately.
 * @returns {Promise<object>} session info
 */
async function createSession(sessionName) {
    return call(async (http) => {
        const res = await http.post('/api/sessions', {
            name: sessionName,
            start: true,
        });
        return unwrap(res);
    });
}

/**
 * POST /api/sessions/{name}/start – start a previously created (STOPPED) session.
 * @returns {Promise<object>} session info
 */
async function startSession(sessionName) {
    return call(async (http) => {
        const res = await http.post(`/api/sessions/${encodeURIComponent(sessionName)}/start`);
        return unwrap(res);
    });
}

/**
 * GET /api/{name}/auth/qr – fetch the pairing QR as base64 PNG.
 * WAHA returns `{ mimetype, data }` when Accept is application/json.
 * @returns {Promise<{mimetype: string, data: string}>}
 */
async function getQrCode(sessionName) {
    return call(async (http) => {
        const res = await http.get(`/api/${encodeURIComponent(sessionName)}/auth/qr`, {
            params: { format: 'image' },
        });
        return unwrap(res);
    });
}

/**
 * POST /api/sendText – send a text message via a specific session.
 * @returns {Promise<object>}
 */
async function sendText(sessionName, chatId, text) {
    return call(async (http) => {
        const res = await http.post(`/api/sendText`, {
            session: sessionName,
            chatId,
            text,
        });
        return unwrap(res, [200, 201]);
    });
}

/**
 * GET /api/{session}/messages/{id}/download – download media as buffer.
 * Returns the buffer and content type.
 */
async function downloadMedia(sessionName, messageId) {
    return call(async (http) => {
        const res = await http.get(`/api/${encodeURIComponent(sessionName)}/messages/${encodeURIComponent(messageId)}/download`, {
            responseType: 'arraybuffer'
        });
        if (res.status === 200) {
            return {
                mimetype: res.headers['content-type'] || 'audio/ogg',
                buffer: Buffer.from(res.data)
            };
        }
        throw new WahaError(
            `[waha] Failed to download media ${messageId}`,
            res.status,
            res.data
        );
    });
}

/**
 * POST /api/{session}/auth/request-code – request pairing code.
 * @returns {Promise<{code: string}>}
 */
async function requestPairingCode(sessionName, phoneNumber) {
    return call(async (http) => {
        const res = await http.post(`/api/${encodeURIComponent(sessionName)}/auth/request-code`, {
            phoneNumber
        });
        return unwrap(res);
    });
}

/**
 * GET /api/{session}/chats – list the active chats for a session.
 *
 * Supports pagination via `limit` and `offset` so the share-routing modal can
 * load the next page of chats without re-fetching ones it already holds.
 *
 * When the session does not yet exist (404) we return an empty array rather
 * than throwing — the modal shows a "Link WhatsApp first" empty state.
 *
 * @param {string} sessionName
 * @param {number} [limit=25]
 * @param {number} [offset=0]
 * @returns {Promise<object[]>} raw WAHA chat objects (may be empty)
 */
async function getChats(sessionName, limit = 25, offset = 0) {
    return call(async (http) => {
        const res = await http.get(`/api/${encodeURIComponent(sessionName)}/chats`, {
            params: { limit, offset },
        });
        // A 404 means "no such session" — not an error for our purposes.
        if (res.status === 404) return [];
        return unwrap(res);
    });
}

module.exports = {
    SessionStatus,
    WahaError,
    getSession,
    createSession,
    startSession,
    getQrCode,
    requestPairingCode,
    sendText,
    downloadMedia,
    getChats,
};
