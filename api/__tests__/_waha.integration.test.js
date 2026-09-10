/**
 * api/__tests__/_waha.integration.test.js
 * ------------------------------------------------------------------
 * Integration tests for the WAHA controller, driven through the real Express
 * app with Supertest.
 *
 * Architecture of the test:
 *
 *   Supertest ──► api/index.js (real routes + real auth middleware)
 *                      │
 *                      ▼  HTTP (axios)
 *              Fake WAHA server (Express, ephemeral port)
 *              • records every request it receives
 *              • enforces the X-Api-Key header
 *              • holds an in-memory session table we can seed per test
 *
 * MongoDB is mocked (no network). JWTs are real and signed with a test secret.
 *
 * The isolation tests are the point of this file: they seed a session for
 * User B, then have User A try every conceivable channel (query, body,
 * header, path) to name B's session – and prove the fake WAHA never saw
 * B's id in any request A made.
 * ------------------------------------------------------------------
 */

process.env.JWT_SECRET = 'unit-test-secret-that-is-at-least-32-characters-long!!';
process.env.NODE_ENV = 'test';

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

jest.mock('../_config/_db', () => jest.fn().mockResolvedValue({}));
jest.mock('../_models/_User', () => ({
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
}));

const User = require('../_models/_User');
const { signToken } = require('../_config/_jwt');
const app = require('../index');

/* -------------------------------------------------------------------------- */
/*                               Fake WAHA server                             */
/* -------------------------------------------------------------------------- */

const API_KEY = 'test-waha-api-key';

/**
 * Build a minimal WAHA look-alike. Only the endpoints our client calls are
 * implemented, with the same paths, methods and payload shapes as WAHA.
 */
function createFakeWaha() {
    const fake = express();
    fake.use(express.json());

    /** @type {Map<string, {name:string,status:string,me?:object}>} */
    const sessions = new Map();
    /** Every request received, in order. */
    const requests = [];
    /** Per-test fault injection switches. */
    const state = { failQr: false };

    fake.use((req, res, next) => {
        requests.push({
            method: req.method,
            url: req.originalUrl,
            body: req.body,
            apiKey: req.get('x-api-key'),
        });
        if (req.get('x-api-key') !== API_KEY) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        return next();
    });

    fake.get('/api/sessions/:name', (req, res) => {
        const s = sessions.get(req.params.name);
        if (!s) return res.status(404).json({ message: 'Session not found' });
        return res.json(s);
    });

    fake.post('/api/sessions', (req, res) => {
        const s = { name: req.body.name, status: 'SCAN_QR_CODE', config: { secret: 'engine-internals' } };
        sessions.set(s.name, s);
        return res.status(201).json(s);
    });

    fake.post('/api/sessions/:name/start', (req, res) => {
        const s = sessions.get(req.params.name);
        if (!s) return res.status(404).json({ message: 'Session not found' });
        s.status = 'SCAN_QR_CODE';
        return res.json(s);
    });

    fake.get('/api/:name/auth/qr', (req, res) => {
        if (state.failQr) return res.status(500).json({ message: 'engine crashed' });
        const s = sessions.get(req.params.name);
        if (!s) return res.status(404).json({ message: 'Session not found' });
        if (s.status !== 'SCAN_QR_CODE') return res.status(422).json({ message: 'Not in QR state' });
        // Encode the session name into the "image" so tests can prove whose QR came back.
        return res.json({ mimetype: 'image/png', data: Buffer.from(`QR-FOR-${s.name}`).toString('base64') });
    });

    return {
        app: fake,
        sessions,
        requests,
        state,
        seed(name, status, me) {
            sessions.set(name, { name, status, ...(me ? { me } : {}) });
        },
        reset() {
            sessions.clear();
            requests.length = 0;
            state.failQr = false;
        },
        /** Did any recorded request mention this string anywhere (URL or body)? */
        sawId(id) {
            return requests.some((r) => r.url.includes(id) || JSON.stringify(r.body || {}).includes(id));
        },
    };
}

/* -------------------------------------------------------------------------- */
/*                                Test fixtures                               */
/* -------------------------------------------------------------------------- */

const userA = { _id: new mongoose.Types.ObjectId().toString(), email: 'a@example.com' };
const userB = { _id: new mongoose.Types.ObjectId().toString(), email: 'b@example.com' };
userA.id = userA._id;
userB.id = userB._id;

const usersById = { [userA.id]: userA, [userB.id]: userB };

const tokenA = signToken(userA.id);
const tokenB = signToken(userB.id);
const tokenDeleted = signToken(new mongoose.Types.ObjectId().toString());

const asA = (req) => req.set('Authorization', `Bearer ${tokenA}`);
const asB = (req) => req.set('Authorization', `Bearer ${tokenB}`);

const decodeQr = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64').toString();

let waha;
let wahaServer;

beforeAll(async () => {
    waha = createFakeWaha();
    await new Promise((resolve) => {
        wahaServer = waha.app.listen(0, '127.0.0.1', resolve);
    });
    process.env.WAHA_URL = `http://127.0.0.1:${wahaServer.address().port}`;
    process.env.WAHA_API_KEY = API_KEY;
});

afterAll(async () => {
    await new Promise((resolve) => wahaServer.close(resolve));
});

beforeEach(() => {
    jest.clearAllMocks();
    waha.reset();
    User.findById.mockImplementation(async (id) => usersById[id] || null);
    User.findByIdAndUpdate.mockResolvedValue({});
    process.env.WAHA_API_KEY = API_KEY;
});

/* -------------------------------------------------------------------------- */
/*                                Authentication                              */
/* -------------------------------------------------------------------------- */

describe('WAHA routes – authentication gate', () => {
    test.each(['/api/waha/qr', '/api/waha/status'])('%s without a token → 401 and WAHA is never called', async (path) => {
        const res = await request(app).get(path);
        expect(res.status).toBe(401);
        expect(waha.requests).toHaveLength(0);
    });

    test('token for a deleted user → 401 and WAHA is never called', async () => {
        const res = await request(app).get('/api/waha/status').set('Authorization', `Bearer ${tokenDeleted}`);
        expect(res.status).toBe(401);
        expect(waha.requests).toHaveLength(0);
    });
});

/* -------------------------------------------------------------------------- */
/*                                 generateQR                                 */
/* -------------------------------------------------------------------------- */

describe('GET /api/waha/qr', () => {
    test('creates a session named after req.user.id and returns its QR', async () => {
        const res = await asA(request(app).get('/api/waha/qr'));

        expect(res.status).toBe(200);
        expect(res.body.session).toBe(userA.id);
        expect(res.body.status).toBe('SCAN_QR_CODE');
        expect(res.body.connected).toBe(false);
        expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
        expect(decodeQr(res.body.qr)).toBe(`QR-FOR-${userA.id}`);

        // The session-creation payload used the authenticated user's id.
        const create = waha.requests.find((r) => r.method === 'POST' && r.url === '/api/sessions');
        expect(create).toBeDefined();
        expect(create.body).toEqual({ name: userA.id, start: true });

        // Every upstream call carried the API key and addressed A's session only.
        expect(waha.requests.every((r) => r.apiKey === API_KEY)).toBe(true);
        expect(waha.requests.filter((r) => r.url.includes(userA.id))).toHaveLength(2); // GET session + GET qr
        expect(waha.sawId(userB.id)).toBe(false);

        // The session name is persisted on the user record.
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith(userA.id, { wahaSessionId: userA.id });
    });

    test('returns connected:true without fetching a QR when already WORKING', async () => {
        waha.seed(userA.id, 'WORKING', { id: '201000000000@c.us', pushName: 'A' });

        const res = await asA(request(app).get('/api/waha/qr'));

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            session: userA.id,
            status: 'WORKING',
            connected: true,
            me: { id: '201000000000@c.us', pushName: 'A' },
        });
        expect(res.body).not.toHaveProperty('qr');
        expect(waha.requests.some((r) => r.url.includes('/auth/qr'))).toBe(false);
    });

    test('restarts a STOPPED session before returning the QR', async () => {
        waha.seed(userA.id, 'STOPPED');

        const res = await asA(request(app).get('/api/waha/qr'));

        expect(res.status).toBe(200);
        expect(decodeQr(res.body.qr)).toBe(`QR-FOR-${userA.id}`);
        expect(waha.requests.some((r) => r.method === 'POST' && r.url === `/api/sessions/${userA.id}/start`)).toBe(true);
        expect(waha.requests.some((r) => r.method === 'POST' && r.url === '/api/sessions')).toBe(false);
    });

    test('returns 202 with retry hint while the engine is STARTING', async () => {
        waha.seed(userA.id, 'STARTING');

        const res = await asA(request(app).get('/api/waha/qr'));

        expect(res.status).toBe(202);
        expect(res.body).toMatchObject({ session: userA.id, status: 'STARTING', connected: false, retryAfterMs: expect.any(Number) });
        expect(res.body).not.toHaveProperty('qr');
    });

    test('does not leak WAHA internals (config) to the client', async () => {
        const res = await asA(request(app).get('/api/waha/qr'));
        expect(res.body).not.toHaveProperty('config');
        expect(JSON.stringify(res.body)).not.toMatch(/engine-internals/);
    });
});

/* -------------------------------------------------------------------------- */
/*                                 checkStatus                                */
/* -------------------------------------------------------------------------- */

describe('GET /api/waha/status', () => {
    test('reports NOT_CREATED when the user has no session yet', async () => {
        const res = await asA(request(app).get('/api/waha/status'));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ session: userA.id, status: 'NOT_CREATED', connected: false, me: null });
    });

    test('reports connected:true and the linked account when WORKING', async () => {
        waha.seed(userA.id, 'WORKING', { id: '201000000000@c.us', pushName: 'A', secretField: 'x' });

        const res = await asA(request(app).get('/api/waha/status'));

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            session: userA.id,
            status: 'WORKING',
            connected: true,
            me: { id: '201000000000@c.us', pushName: 'A' }, // secretField whitelisted away
        });
        expect(waha.requests).toEqual([
            expect.objectContaining({ method: 'GET', url: `/api/sessions/${userA.id}`, apiKey: API_KEY }),
        ]);
    });
});

/* -------------------------------------------------------------------------- */
/*                         Tenant isolation: A vs B                           */
/* -------------------------------------------------------------------------- */

describe('Tenant isolation – User A cannot reach User B\'s session', () => {
    beforeEach(() => {
        // B is fully connected; A has nothing. If any A request returns
        // WORKING / connected:true, isolation has been breached.
        waha.seed(userB.id, 'WORKING', { id: '201999999999@c.us', pushName: 'B' });
    });

    test('status: ?session=<B> in the query string is ignored', async () => {
        const res = await asA(request(app).get('/api/waha/status').query({ session: userB.id, name: userB.id, id: userB.id }));

        expect(res.status).toBe(200);
        expect(res.body.session).toBe(userA.id);
        expect(res.body.connected).toBe(false);
        expect(res.body.status).toBe('NOT_CREATED');
        expect(waha.sawId(userB.id)).toBe(false);
    });

    test('status: a JSON body naming B is ignored', async () => {
        const res = await asA(request(app).get('/api/waha/status').send({ session: userB.id, wahaSessionId: userB.id }));

        expect(res.status).toBe(200);
        expect(res.body.session).toBe(userA.id);
        expect(res.body.connected).toBe(false);
        expect(waha.sawId(userB.id)).toBe(false);
    });

    test('status: custom headers naming B are ignored', async () => {
        const res = await asA(request(app).get('/api/waha/status').set('X-Session', userB.id).set('X-User-Id', userB.id));

        expect(res.body.session).toBe(userA.id);
        expect(res.body.connected).toBe(false);
        expect(waha.sawId(userB.id)).toBe(false);
    });

    test('status: there is no /:session path parameter to abuse', async () => {
        const res = await asA(request(app).get(`/api/waha/status/${userB.id}`));

        expect(res.status).toBe(404);
        expect(waha.requests).toHaveLength(0);
    });

    test('qr: ?session=<B> is ignored – A gets a session and QR for A', async () => {
        const res = await asA(request(app).get('/api/waha/qr').query({ session: userB.id }).send({ name: userB.id }));

        expect(res.status).toBe(200);
        expect(res.body.session).toBe(userA.id);
        expect(decodeQr(res.body.qr)).toBe(`QR-FOR-${userA.id}`);

        const create = waha.requests.find((r) => r.method === 'POST' && r.url === '/api/sessions');
        expect(create.body.name).toBe(userA.id);
        expect(waha.sawId(userB.id)).toBe(false);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalledWith(userB.id, expect.anything());
    });

    test('qr: there is no /qr/:session path to abuse', async () => {
        const res = await asA(request(app).get(`/api/waha/qr/${userB.id}`));
        expect(res.status).toBe(404);
        expect(waha.requests).toHaveLength(0);
    });

    test('B sees B\'s own connected session; A still sees nothing', async () => {
        const resB = await asB(request(app).get('/api/waha/status'));
        const resA = await asA(request(app).get('/api/waha/status'));

        expect(resB.body).toMatchObject({ session: userB.id, connected: true, me: { pushName: 'B' } });
        expect(resA.body).toMatchObject({ session: userA.id, connected: false, me: null });

        // Each token only ever produced upstream calls for its own id.
        const urls = waha.requests.map((r) => r.url);
        expect(urls).toEqual([`/api/sessions/${userB.id}`, `/api/sessions/${userA.id}`]);
    });

    test('a token forged for B\'s id but signed with the wrong secret is rejected', async () => {
        const jwt = require('jsonwebtoken');
        const { ISSUER, AUDIENCE } = require('../_config/_jwt');
        const forged = jwt.sign({}, 'not-the-real-secret-but-still-long-enough-1234', {
            algorithm: 'HS256', subject: userB.id, issuer: ISSUER, audience: AUDIENCE, expiresIn: '1h',
        });

        const res = await request(app).get('/api/waha/status').set('Authorization', `Bearer ${forged}`);

        expect(res.status).toBe(401);
        expect(waha.requests).toHaveLength(0);
    });
});

/* -------------------------------------------------------------------------- */
/*                              Upstream failures                             */
/* -------------------------------------------------------------------------- */

describe('WAHA failures surface as 502, never as 500 or as another tenant\'s data', () => {
    test('WAHA rejects our API key → 502 with a generic message', async () => {
        process.env.WAHA_API_KEY = 'wrong-key';
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const res = await asA(request(app).get('/api/waha/status'));

        expect(res.status).toBe(502);
        expect(res.body).toEqual({ message: expect.any(String) });
        expect(JSON.stringify(res.body)).not.toMatch(/Unauthorized|401/);
        spy.mockRestore();
    });

    test('WAHA unreachable → 502', async () => {
        const saved = process.env.WAHA_URL;
        process.env.WAHA_URL = 'http://127.0.0.1:1'; // nothing listens on port 1
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const res = await asA(request(app).get('/api/waha/qr'));

        expect(res.status).toBe(502);
        process.env.WAHA_URL = saved;
        spy.mockRestore();
    });

    test('QR endpoint failing mid-flow → 502, and only A\'s id was ever used upstream', async () => {
        waha.state.failQr = true;
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const res = await asA(request(app).get('/api/waha/qr'));

        spy.mockRestore();
        expect(res.status).toBe(502);
        expect(res.body).toEqual({ message: expect.any(String) });
        expect(JSON.stringify(res.body)).not.toMatch(/engine crashed/);
        // Session was still created for A before the QR step failed.
        const create = waha.requests.find((r) => r.method === 'POST' && r.url === '/api/sessions');
        expect(create.body.name).toBe(userA.id);
        expect(waha.sawId(userB.id)).toBe(false);
    });
});
