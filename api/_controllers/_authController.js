/**
 * api/_controllers/_authController.js
 * ------------------------------------------------------------------
 * Registration, login and "who am I" handlers.
 *
 * Security properties enforced here:
 *   1. Strict input typing  – only plain strings reach Mongoose. An object such
 *      as `{ "$gt": "" }` sent as `email` would otherwise become a NoSQL
 *      operator injection and match *every* user.
 *   2. bcrypt with a configurable, sane cost factor.
 *   3. Uniform failure responses – login never reveals whether the email or
 *      the password was wrong, and takes roughly the same time either way.
 *   4. Password hashes are never serialised to the client (the User model's
 *      `select: false` + toJSON transform, plus an explicit strip here).
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const bcrypt = require('bcryptjs');

const connectDB = require('../_config/_db');
const User = require('../_models/_User');
const { signToken } = require('../_config/_jwt');

/* -------------------------------------------------------------------------- */
/*                                  Constants                                 */
/* -------------------------------------------------------------------------- */

/**
 * bcrypt work factor. 12 is the OWASP-recommended floor as of 2024-2026 and
 * costs ~250 ms on a typical Vercel lambda – acceptable for auth endpoints.
 * Tests override this via env to keep the suite fast.
 */
const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

/** Password policy. Length is the only rule that measurably helps. */
const PASSWORD_MIN_LENGTH = 8;

/**
 * bcrypt silently truncates input at 72 bytes; anything longer adds no
 * security. Capping also prevents a client from making us hash megabytes.
 */
const PASSWORD_MAX_LENGTH = 72;

/** Same permissive check the User schema uses. */
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

/**
 * A bcrypt hash of a random string, generated lazily at the *same cost factor*
 * as real user hashes. When a login targets an email that does not exist we
 * still run `bcrypt.compare` against this value so that the request takes the
 * same time as a wrong-password attempt. Otherwise an attacker could enumerate
 * registered emails by measuring response time.
 *
 * Generated on first use (not at module load) to keep cold starts fast, then
 * cached for the lifetime of the container.
 */
let dummyHashPromise = null;
function getDummyHash() {
    if (!dummyHashPromise) {
        const random = require('crypto').randomBytes(32).toString('hex');
        dummyHashPromise = bcrypt.hash(random, BCRYPT_ROUNDS);
    }
    return dummyHashPromise;
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

/**
 * Validate and normalise credentials coming off `req.body`.
 *
 * Returns `{ error }` on failure so callers can respond 400 and stop, or
 * `{ email, password }` with the email lower-cased/trimmed on success.
 *
 * @param {unknown} body
 * @param {{ enforcePolicy?: boolean }} [opts] apply password policy (register only)
 */
function parseCredentials(body, { enforcePolicy = false } = {}) {
    if (!body || typeof body !== 'object') {
        return { error: 'Request body must be a JSON object' };
    }

    const { email, password } = body;

    // typeof checks are the NoSQL-injection guard – do not relax them.
    if (typeof email !== 'string' || typeof password !== 'string') {
        return { error: 'Email and password are required' };
    }

    const normalisedEmail = email.trim().toLowerCase();

    if (!normalisedEmail || !EMAIL_REGEX.test(normalisedEmail)) {
        return { error: 'Please provide a valid email address' };
    }

    if (!password) {
        return { error: 'Email and password are required' };
    }

    if (enforcePolicy) {
        if (password.length < PASSWORD_MIN_LENGTH) {
            return { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
        }
        if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_LENGTH) {
            return { error: `Password must be at most ${PASSWORD_MAX_LENGTH} bytes` };
        }
    }

    return { email: normalisedEmail, password };
}

/**
 * Shape the user document for the client. Belt-and-braces: the model already
 * hides `password`, but a future `.select('+password')` elsewhere must never
 * leak through this controller.
 *
 * @param {import('mongoose').Document|object} user
 */
function toPublicUser(user) {
    const plain = typeof user.toJSON === 'function' ? user.toJSON() : { ...user };
    delete plain.password;
    delete plain.__v;
    return plain;
}

/* -------------------------------------------------------------------------- */
/*                                  Handlers                                  */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/auth/register
 * Body: { email, password }
 * 201 → { token, user }
 * 400 → validation error
 * 409 → email already registered
 */
async function register(req, res) {
    const parsed = parseCredentials(req.body, { enforcePolicy: true });
    if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
    }

    try {
        await connectDB();

        const hashedPassword = await bcrypt.hash(parsed.password, BCRYPT_ROUNDS);

        // We rely on the unique index rather than a find-then-create check:
        // two simultaneous sign-ups with the same email would both pass a
        // pre-check, but only one can win the index.
        const user = await User.create({
            email: parsed.email,
            password: hashedPassword,
        });

        const token = signToken(user._id);

        return res.status(201).json({ token, user: toPublicUser(user) });
    } catch (err) {
        // MongoServerError 11000 = duplicate key (unique index violation).
        if (err && err.code === 11000) {
            return res.status(409).json({ message: 'An account with this email already exists' });
        }

        // Mongoose schema validation (e.g. bad email that slipped past regex).
        if (err && err.name === 'ValidationError') {
            return res.status(400).json({ message: 'Invalid registration data' });
        }

        console.error('[auth] register failed:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * 200 → { token, user }
 * 400 → malformed input
 * 401 → invalid credentials (deliberately generic)
 */
async function login(req, res) {
    const parsed = parseCredentials(req.body);
    if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
    }

    try {
        await connectDB();

        // `password` is `select: false` on the schema, so opt back in here.
        // Passing the projection as the 2nd argument (rather than chaining
        // `.select()`) keeps the call trivially mockable in unit tests.
        const user = await User.findOne({ email: parsed.email }, '+password');

        // Always perform a bcrypt comparison so timing is uniform whether or
        // not the account exists (see getDummyHash above).
        const hashToCompare = user && user.password ? user.password : await getDummyHash();
        const passwordMatches = await bcrypt.compare(parsed.password, hashToCompare);

        if (!user || !passwordMatches) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const token = signToken(user._id);

        return res.status(200).json({ token, user: toPublicUser(user) });
    } catch (err) {
        console.error('[auth] login failed:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

/**
 * GET /api/auth/me   (protected by _authMiddleware)
 * 200 → { user }
 *
 * The middleware has already loaded and attached the user, so this handler
 * is intentionally trivial. It exists mainly so clients can validate a
 * stored token on app start.
 */
async function me(req, res) {
    return res.status(200).json({ user: toPublicUser(req.user) });
}

module.exports = {
    register,
    login,
    me,
    // Exported for unit tests.
    _internal: { parseCredentials, toPublicUser, BCRYPT_ROUNDS },
};
