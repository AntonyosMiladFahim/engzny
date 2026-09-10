/**
 * api/__tests__/_authMiddleware.test.js
 * ------------------------------------------------------------------
 * Unit tests for the JWT gate. The database layer is fully mocked so these
 * run in milliseconds with no network access.
 *
 * The suite is organised around *how* a token can be wrong, because each
 * bullet below is a distinct real-world attack or failure mode:
 *   - missing / malformed Authorization header
 *   - garbage that is not a JWT at all
 *   - correct structure, wrong signature (attacker-forged)
 *   - `alg: none` (signature-stripping attack)
 *   - expired
 *   - not-yet-valid (nbf)
 *   - wrong issuer / audience (token from a sibling service)
 *   - valid signature but non-ObjectId subject (forged with a leaked secret)
 *   - valid signature but the user has since been deleted
 * ------------------------------------------------------------------
 */

// Must be set BEFORE the modules under test are required.
process.env.JWT_SECRET = 'unit-test-secret-that-is-at-least-32-characters-long!!';

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// ---- Mocks ---------------------------------------------------------------

// Never open a real connection in unit tests.
jest.mock('../_config/_db', () => jest.fn().mockResolvedValue({}));

// Replace the Mongoose model with a plain object exposing only what the
// middleware calls. Using a factory (not automock) avoids loading Mongoose's
// model machinery.
jest.mock('../_models/_User', () => ({
    findById: jest.fn(),
}));

const connectDB = require('../_config/_db');
const User = require('../_models/_User');
const requireAuth = require('../_middlewares/_authMiddleware');
const { extractBearerToken } = require('../_middlewares/_authMiddleware');
const { signToken, ISSUER, AUDIENCE } = require('../_config/_jwt');

// ---- Test helpers --------------------------------------------------------

const SECRET = process.env.JWT_SECRET;
const WRONG_SECRET = 'a-completely-different-secret-that-is-also-long-enough';

/** A user id that satisfies `mongoose.isValidObjectId`. */
const userId = new mongoose.Types.ObjectId().toString();

/** Minimal Express-like request. */
function mockReq(authorization) {
    return { headers: authorization === undefined ? {} : { authorization } };
}

/** Minimal Express-like response with chainable status().json(). */
function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

/** Run the middleware and return { res, next } for assertions. */
async function run(authorization) {
    const req = mockReq(authorization);
    const res = mockRes();
    const next = jest.fn();
    await requireAuth(req, res, next);
    return { req, res, next };
}

/** Assert the standard 401 shape and that the route handler never ran. */
function expectRejected({ res, next }, expectedStatus = 401) {
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) })
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    // Default: the user exists.
    User.findById.mockResolvedValue({ _id: userId, email: 'a@b.com' });
});

// ---- extractBearerToken --------------------------------------------------

describe('extractBearerToken', () => {
    test.each([
        [undefined, null],
        ['', null],
        ['Bearer', null],
        ['Bearer ', null],
        ['Basic dXNlcjpwYXNz', null],
        ['Token abc', null],
        ['Bearer abc def', null],
        ['Bearer abc', 'abc'],
        ['bearer abc', 'abc'], // scheme is case-insensitive per RFC 6750
        ['  Bearer   abc  ', 'abc'],
    ])('header %p → %p', (header, expected) => {
        expect(extractBearerToken(mockReq(header))).toBe(expected);
    });

    test('ignores a non-string header value', () => {
        expect(extractBearerToken({ headers: { authorization: ['Bearer', 'abc'] } })).toBeNull();
    });
});

// ---- Header-level rejections --------------------------------------------

describe('requireAuth – header problems', () => {
    test('rejects when Authorization header is missing', async () => {
        expectRejected(await run(undefined));
        expect(User.findById).not.toHaveBeenCalled();
    });

    test('rejects a non-Bearer scheme', async () => {
        expectRejected(await run('Basic dXNlcjpwYXNz'));
    });

    test('rejects "Bearer" with no token', async () => {
        expectRejected(await run('Bearer '));
    });
});

// ---- Token-level rejections ---------------------------------------------

describe('requireAuth – invalid tokens', () => {
    test('rejects a string that is not a JWT', async () => {
        expectRejected(await run('Bearer this-is-not-a-jwt'));
        expect(User.findById).not.toHaveBeenCalled();
    });

    test('rejects a token signed with the wrong secret', async () => {
        const forged = jwt.sign({}, WRONG_SECRET, {
            algorithm: 'HS256', subject: userId, issuer: ISSUER, audience: AUDIENCE, expiresIn: '1h',
        });
        expectRejected(await run(`Bearer ${forged}`));
        expect(User.findById).not.toHaveBeenCalled();
    });

    test('rejects a tampered payload (signature no longer matches)', async () => {
        const good = signToken(userId);
        const [header, , signature] = good.split('.');
        const otherId = new mongoose.Types.ObjectId().toString();
        const tamperedPayload = Buffer.from(
            JSON.stringify({ sub: otherId, iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 3600 })
        ).toString('base64url');
        expectRejected(await run(`Bearer ${header}.${tamperedPayload}.${signature}`));
    });

    test('rejects an unsigned "alg: none" token', async () => {
        const unsigned = jwt.sign({}, '', {
            algorithm: 'none', subject: userId, issuer: ISSUER, audience: AUDIENCE, expiresIn: '1h',
        });
        expect(unsigned.endsWith('.')).toBe(true); // sanity: really has no signature
        expectRejected(await run(`Bearer ${unsigned}`));
    });

    test('rejects an expired token', async () => {
        const expired = jwt.sign({}, SECRET, {
            algorithm: 'HS256', subject: userId, issuer: ISSUER, audience: AUDIENCE, expiresIn: -10,
        });
        const result = await run(`Bearer ${expired}`);
        expectRejected(result);
        expect(result.res.json).toHaveBeenCalledWith({ message: expect.stringMatching(/expired/i) });
    });

    test('rejects a not-yet-valid (nbf) token', async () => {
        const future = jwt.sign({}, SECRET, {
            algorithm: 'HS256', subject: userId, issuer: ISSUER, audience: AUDIENCE, expiresIn: '1h', notBefore: '1h',
        });
        expectRejected(await run(`Bearer ${future}`));
    });

    test('rejects a token from a different issuer', async () => {
        const foreign = jwt.sign({}, SECRET, {
            algorithm: 'HS256', subject: userId, issuer: 'some-other-service', audience: AUDIENCE, expiresIn: '1h',
        });
        expectRejected(await run(`Bearer ${foreign}`));
    });

    test('rejects a token for a different audience', async () => {
        const foreign = jwt.sign({}, SECRET, {
            algorithm: 'HS256', subject: userId, issuer: ISSUER, audience: 'admin-panel', expiresIn: '1h',
        });
        expectRejected(await run(`Bearer ${foreign}`));
    });

    test('rejects a correctly-signed token whose subject is not an ObjectId', async () => {
        const weird = jwt.sign({}, SECRET, {
            algorithm: 'HS256', subject: '{"$gt":""}', issuer: ISSUER, audience: AUDIENCE, expiresIn: '1h',
        });
        expectRejected(await run(`Bearer ${weird}`));
        // The injection payload must never reach the database layer.
        expect(User.findById).not.toHaveBeenCalled();
    });

    test('rejects a correctly-signed token with no subject at all', async () => {
        const noSub = jwt.sign({}, SECRET, {
            algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: '1h',
        });
        expectRejected(await run(`Bearer ${noSub}`));
        expect(User.findById).not.toHaveBeenCalled();
    });

    test('rejects a valid token whose user has been deleted', async () => {
        User.findById.mockResolvedValue(null);
        expectRejected(await run(`Bearer ${signToken(userId)}`));
        expect(User.findById).toHaveBeenCalledWith(userId, expect.any(String));
    });
});

// ---- Server-side failures -----------------------------------------------

describe('requireAuth – infrastructure errors', () => {
    test('returns 500 (not 401) when the database lookup throws', async () => {
        User.findById.mockRejectedValue(new Error('connection lost'));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        expectRejected(await run(`Bearer ${signToken(userId)}`), 500);
        spy.mockRestore();
    });

    test('returns 401 when the server has no JWT secret configured', async () => {
        const token = signToken(userId);
        const saved = process.env.JWT_SECRET;
        delete process.env.JWT_SECRET;
        try {
            expectRejected(await run(`Bearer ${token}`));
        } finally {
            process.env.JWT_SECRET = saved;
        }
    });
});

// ---- Happy path ----------------------------------------------------------

describe('requireAuth – valid token', () => {
    test('calls next() and attaches the user', async () => {
        const dbUser = { _id: userId, email: 'a@b.com', wahaSessionId: null };
        User.findById.mockResolvedValue(dbUser);

        const { req, res, next } = await run(`Bearer ${signToken(userId)}`);

        expect(connectDB).toHaveBeenCalledTimes(1);
        expect(User.findById).toHaveBeenCalledWith(userId, expect.any(String));
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(); // no error argument
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toBe(dbUser);
        expect(req.auth).toEqual({ userId, tokenExp: expect.any(Number) });
    });

    test('accepts a lower-case "bearer" scheme', async () => {
        const { next } = await run(`bearer ${signToken(userId)}`);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
