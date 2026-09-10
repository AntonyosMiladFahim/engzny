/**
 * api/_config/_jwt.js
 * ------------------------------------------------------------------
 * Single source of truth for JSON Web Token creation and verification.
 *
 * Keeping sign + verify in one module guarantees that both sides agree on
 * the algorithm, issuer and audience. Duplicating these constants across the
 * controller and the middleware is exactly how "alg confusion" and
 * "wrong audience accepted" bugs creep in.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const jwt = require('jsonwebtoken');

/**
 * Only HS256 is ever accepted. Pinning the algorithm list on *verify* is the
 * critical part: without it an attacker could present a token with
 * `"alg": "none"` (or switch to RS256 and supply their own public key) and
 * `jsonwebtoken` would happily accept it.
 */
const ALGORITHM = 'HS256';

/** Identifies who minted the token; verified on every request. */
const ISSUER = 'engzny-api';

/** Identifies who the token is for; verified on every request. */
const AUDIENCE = 'engzny-client';

/** Default lifetime. Overridable via env so staging can use short tokens. */
const DEFAULT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Minimum acceptable secret length. HS256 uses HMAC-SHA256, whose security is
 * bounded by the secret's entropy. 32 bytes (256 bits) matches the hash size.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Resolve the signing secret from the environment.
 *
 * Resolved lazily (per call) rather than at module load so that:
 *   - importing this module in unit tests never throws, and
 *   - tests can swap `process.env.JWT_SECRET` between cases.
 *
 * @returns {string}
 * @throws  {Error} if the secret is missing or too weak
 */
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        throw new Error(
            '[jwt] JWT_SECRET is not defined. Add a long random value to .env ' +
            'locally and to the Vercel Environment Variables in production. ' +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
        );
    }

    if (secret.length < MIN_SECRET_LENGTH) {
        throw new Error(
            `[jwt] JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`
        );
    }

    return secret;
}

/**
 * Mint an access token for a user.
 *
 * We deliberately put ONLY the user id in the `sub` claim. Emails, roles or
 * other profile data are looked up fresh from the database on each request
 * (see _authMiddleware.js) so a stale token can never grant stale privileges.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {object} [options]
 * @param {string|number} [options.expiresIn] override the default lifetime
 * @returns {string} signed compact JWS
 */
function signToken(userId, options = {}) {
    if (!userId) {
        throw new Error('[jwt] signToken requires a userId');
    }

    return jwt.sign(
        {},
        getJwtSecret(),
        {
            algorithm: ALGORITHM,
            subject: String(userId),
            issuer: ISSUER,
            audience: AUDIENCE,
            expiresIn: options.expiresIn || DEFAULT_EXPIRES_IN,
        }
    );
}

/**
 * Verify a token and return its decoded payload.
 *
 * Throws (does not return null) on ANY failure so callers cannot forget to
 * check a return value. The thrown error is one of `jsonwebtoken`'s
 * `JsonWebTokenError` / `TokenExpiredError` / `NotBeforeError`.
 *
 * @param {string} token compact JWS from the Authorization header
 * @returns {import('jsonwebtoken').JwtPayload} decoded claims (includes `sub`)
 */
function verifyToken(token) {
    return jwt.verify(token, getJwtSecret(), {
        algorithms: [ALGORITHM], // <-- pin the algorithm list
        issuer: ISSUER,
        audience: AUDIENCE,
    });
}

module.exports = {
    signToken,
    verifyToken,
    getJwtSecret,
    // Exported for tests that need to forge tokens with the right claims.
    ALGORITHM,
    ISSUER,
    AUDIENCE,
};
