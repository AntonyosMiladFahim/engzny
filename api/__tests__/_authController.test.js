/**
 * api/__tests__/_authController.test.js
 * ------------------------------------------------------------------
 * Unit tests for register / login / me.
 *
 * bcrypt is real (not mocked) so we exercise the actual hash/compare code
 * path, but the cost factor is dropped to 4 via env to keep the suite fast.
 * Mongoose is mocked entirely.
 * ------------------------------------------------------------------
 */

process.env.JWT_SECRET = 'unit-test-secret-that-is-at-least-32-characters-long!!';
process.env.BCRYPT_ROUNDS = '4';

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

jest.mock('../_config/_db', () => jest.fn().mockResolvedValue({}));
jest.mock('../_models/_User', () => ({
    create: jest.fn(),
    findOne: jest.fn(),
}));

const User = require('../_models/_User');
const { verifyToken } = require('../_config/_jwt');
const { register, login, me, _internal } = require('../_controllers/_authController');

// ---- Helpers -------------------------------------------------------------

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

/** Build a fake Mongoose document with a toJSON that mimics the schema transform. */
function fakeUserDoc({ email, password }) {
    const _id = new mongoose.Types.ObjectId();
    return {
        _id,
        email,
        password,
        toJSON() {
            return { _id: _id.toString(), email }; // password intentionally omitted
        },
    };
}

/** Grab the body passed to res.json(). */
const bodyOf = (res) => res.json.mock.calls[0][0];

beforeEach(() => jest.clearAllMocks());

// ---- parseCredentials ----------------------------------------------------

describe('parseCredentials', () => {
    const { parseCredentials } = _internal;

    test('normalises email to lower-case and trims it', () => {
        expect(parseCredentials({ email: '  Foo@Bar.COM ', password: 'x' }))
            .toEqual({ email: 'foo@bar.com', password: 'x' });
    });

    test.each([
        [undefined],
        [null],
        ['a string body'],
        [{}],
        [{ email: 'a@b.com' }],
        [{ password: 'secret123' }],
        [{ email: '', password: 'secret123' }],
        [{ email: 'a@b.com', password: '' }],
        [{ email: 'not-an-email', password: 'secret123' }],
    ])('rejects body %p', (body) => {
        expect(parseCredentials(body)).toHaveProperty('error');
    });

    test('rejects NoSQL operator objects in place of strings', () => {
        expect(parseCredentials({ email: { $gt: '' }, password: 'x' })).toHaveProperty('error');
        expect(parseCredentials({ email: 'a@b.com', password: { $gt: '' } })).toHaveProperty('error');
        expect(parseCredentials({ email: ['a@b.com'], password: 'x' })).toHaveProperty('error');
    });

    test('applies the password policy only when asked', () => {
        const weak = { email: 'a@b.com', password: 'short' };
        expect(parseCredentials(weak)).not.toHaveProperty('error');
        expect(parseCredentials(weak, { enforcePolicy: true })).toHaveProperty('error');

        const tooLong = { email: 'a@b.com', password: 'a'.repeat(73) };
        expect(parseCredentials(tooLong, { enforcePolicy: true })).toHaveProperty('error');
    });
});

// ---- register ------------------------------------------------------------

describe('register', () => {
    test('400 on missing fields', async () => {
        const res = mockRes();
        await register({ body: { email: 'a@b.com' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(User.create).not.toHaveBeenCalled();
    });

    test('400 on weak password', async () => {
        const res = mockRes();
        await register({ body: { email: 'a@b.com', password: '1234567' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(User.create).not.toHaveBeenCalled();
    });

    test('400 on injection-shaped input', async () => {
        const res = mockRes();
        await register({ body: { email: { $ne: null }, password: 'password123' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(User.create).not.toHaveBeenCalled();
    });

    test('409 when the unique index rejects a duplicate email', async () => {
        User.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
        const res = mockRes();
        await register({ body: { email: 'a@b.com', password: 'password123' } }, res);
        expect(res.status).toHaveBeenCalledWith(409);
    });

    test('500 on unexpected error, without leaking details', async () => {
        User.create.mockRejectedValue(new Error('disk on fire'));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const res = mockRes();
        await register({ body: { email: 'a@b.com', password: 'password123' } }, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(JSON.stringify(bodyOf(res))).not.toMatch(/disk on fire/);
        spy.mockRestore();
    });

    test('201 with a verifiable token, hashed password stored, none returned', async () => {
        User.create.mockImplementation(async (data) => fakeUserDoc(data));
        const res = mockRes();

        await register({ body: { email: 'New@Example.com', password: 'password123' } }, res);

        // Stored email is normalised and password is a bcrypt hash, not plain.
        const stored = User.create.mock.calls[0][0];
        expect(stored.email).toBe('new@example.com');
        expect(stored.password).not.toBe('password123');
        expect(stored.password).toMatch(/^\$2[aby]\$/);
        expect(await bcrypt.compare('password123', stored.password)).toBe(true);

        expect(res.status).toHaveBeenCalledWith(201);
        const body = bodyOf(res);
        expect(body.user).toEqual({ _id: expect.any(String), email: 'new@example.com' });
        expect(body.user).not.toHaveProperty('password');

        // The token must verify under our own rules and point at this user.
        const claims = verifyToken(body.token);
        expect(claims.sub).toBe(body.user._id);
    });
});

// ---- login ---------------------------------------------------------------

describe('login', () => {
    const PASSWORD = 'correct-horse-battery';
    let hash;

    beforeAll(async () => {
        hash = await bcrypt.hash(PASSWORD, 4);
    });

    test('400 on malformed input, without touching the database', async () => {
        const res = mockRes();
        await login({ body: { email: { $gt: '' }, password: 'x' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(User.findOne).not.toHaveBeenCalled();
    });

    test('401 for an unknown email (generic message)', async () => {
        User.findOne.mockResolvedValue(null);
        const res = mockRes();
        await login({ body: { email: 'nobody@b.com', password: PASSWORD } }, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(bodyOf(res)).toEqual({ message: 'Invalid email or password' });
    });

    test('401 for a wrong password (identical message to unknown email)', async () => {
        User.findOne.mockResolvedValue(fakeUserDoc({ email: 'a@b.com', password: hash }));
        const res = mockRes();
        await login({ body: { email: 'a@b.com', password: 'wrong-password' } }, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(bodyOf(res)).toEqual({ message: 'Invalid email or password' });
    });

    test('still runs a bcrypt compare when the user does not exist (timing uniformity)', async () => {
        User.findOne.mockResolvedValue(null);
        const spy = jest.spyOn(bcrypt, 'compare');
        await login({ body: { email: 'nobody@b.com', password: PASSWORD } }, mockRes());
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    test('queries with the normalised email and opts the password field back in', async () => {
        User.findOne.mockResolvedValue(null);
        await login({ body: { email: '  A@B.com ', password: PASSWORD } }, mockRes());
        expect(User.findOne).toHaveBeenCalledWith({ email: 'a@b.com' }, '+password');
    });

    test('200 with a token and public user on correct credentials', async () => {
        const doc = fakeUserDoc({ email: 'a@b.com', password: hash });
        User.findOne.mockResolvedValue(doc);
        const res = mockRes();

        await login({ body: { email: 'a@b.com', password: PASSWORD } }, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const body = bodyOf(res);
        expect(body.user).not.toHaveProperty('password');
        expect(verifyToken(body.token).sub).toBe(doc._id.toString());
    });

    test('500 when the database throws', async () => {
        User.findOne.mockRejectedValue(new Error('boom'));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const res = mockRes();
        await login({ body: { email: 'a@b.com', password: PASSWORD } }, res);
        expect(res.status).toHaveBeenCalledWith(500);
        spy.mockRestore();
    });
});

// ---- me ------------------------------------------------------------------

describe('me', () => {
    test('returns the user attached by the middleware, minus sensitive fields', async () => {
        const res = mockRes();
        await me({ user: { _id: 'x', email: 'a@b.com', password: 'hash', __v: 0 } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(bodyOf(res)).toEqual({ user: { _id: 'x', email: 'a@b.com' } });
    });
});
