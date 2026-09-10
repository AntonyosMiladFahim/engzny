/**
 * api/_models/_User.js
 * ------------------------------------------------------------------
 * User model – one document per tenant of the SaaS.
 *
 * Multi-tenancy is enforced by every other collection (Folder, VoiceNote)
 * carrying a `userId` foreign key back to this document. Controllers MUST
 * always scope their queries by the authenticated user's `_id`.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const userSchema = new Schema(
    {
        /**
         * Login identifier. Stored lower-cased and trimmed so that
         * "Foo@Bar.com" and "foo@bar.com " resolve to the same account.
         * `unique: true` creates a unique index at the DB level – the only
         * reliable guard against duplicate accounts under concurrent sign-ups.
         */
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
            // Intentionally permissive regex – real validation happens by
            // sending a verification e-mail, not by regex gymnastics.
            match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
        },

        /**
         * bcrypt hash of the user's password. NEVER store plain text here.
         * Hashing is the controller's responsibility (bcryptjs is already in
         * package.json). `select: false` means the hash is excluded from every
         * query result by default; use `.select('+password')` when you
         * explicitly need it for login comparison.
         */
        password: {
            type: String,
            required: [true, 'Password is required'],
            minlength: [60, 'Password must be stored as a bcrypt hash'], // bcrypt hashes are always 60 chars
            select: false,
        },

        /**
         * The WAHA (WhatsApp HTTP API) session that belongs to this tenant.
         * Each user gets their own WhatsApp session so that voice notes are
         * routed to the correct account. `sparse: true` lets multiple users
         * exist *without* a session yet (null values are not indexed), while
         * still guaranteeing that a given session is never shared.
         */
        wahaSessionId: {
            type: String,
            trim: true,
            unique: true,
            sparse: true,
        },
    },
    {
        // Adds `createdAt` and `updatedAt` automatically.
        timestamps: true,

        // Strip internal fields whenever a document is serialised to JSON
        // (e.g. `res.json(user)`), so hashes/versions never leak to clients.
        toJSON: {
            transform(_doc, ret) {
                delete ret.password;
                delete ret.__v;
                return ret;
            },
        },
    }
);

/**
 * Serverless-safe model export.
 *
 * On a warm lambda the module cache may be cleared while Mongoose's internal
 * model registry persists. Calling `mongoose.model('User', schema)` a second
 * time would then throw `OverwriteModelError`. Re-using the existing model
 * when present avoids that crash.
 */
module.exports = mongoose.models.User || mongoose.model('User', userSchema);
