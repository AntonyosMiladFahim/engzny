/**
 * api/_models/_Folder.js
 * ------------------------------------------------------------------
 * Folder model – a user-defined bucket for organising voice notes.
 *
 * Tenant isolation: every folder belongs to exactly one user via `userId`.
 * Queries must always include `{ userId: req.user._id }`.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const folderSchema = new Schema(
    {
        /**
         * Human-readable folder label shown in the UI.
         */
        name: {
            type: String,
            required: [true, 'Folder name is required'],
            trim: true,
            maxlength: [100, 'Folder name cannot exceed 100 characters'],
        },

        /**
         * Owning tenant. `ref: 'User'` enables `.populate('userId')` and
         * documents the relationship. `index: true` speeds up the very common
         * "list all folders for this user" query.
         */
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Folder must belong to a user'],
            index: true,
        },
    },
    {
        timestamps: true,
        toJSON: {
            transform(_doc, ret) {
                delete ret.__v;
                return ret;
            },
        },
    }
);

/**
 * A user should not be able to create two folders with the same name.
 * A compound unique index scopes uniqueness *per user*, so two different
 * users can both have a folder called "Work".
 */
folderSchema.index({ userId: 1, name: 1 }, { unique: true });

// Serverless-safe export (see _User.js for the rationale).
module.exports = mongoose.models.Folder || mongoose.model('Folder', folderSchema);
