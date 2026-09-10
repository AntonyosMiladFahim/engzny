/**
 * api/_models/_VoiceNote.js
 * ------------------------------------------------------------------
 * VoiceNote model – one document per WhatsApp voice message that has been
 * received (via WAHA) and summarised (via the AI controller).
 *
 * Tenant isolation: `userId` is mandatory; `folderId` is optional so that a
 * note can exist in the user's "inbox" before being filed.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const voiceNoteSchema = new Schema(
    {
        /**
         * Owning tenant. Indexed because the dashboard lists notes per user.
         */
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Voice note must belong to a user'],
            index: true,
        },

        /**
         * Optional folder the note has been filed into. `null` == unfiled.
         * Controllers should verify the folder belongs to the same `userId`
         * before assigning it, to prevent cross-tenant folder references.
         */
        folderId: {
            type: Schema.Types.ObjectId,
            ref: 'Folder',
            default: null,
            index: true,
        },

        /**
         * Location of the raw audio as delivered by WAHA (typically an
         * `.ogg`/opus file). We store a URL rather than the binary itself to
         * keep documents small and well under MongoDB's 16 MB limit.
         */
        originalAudioUrl: {
            type: String,
            required: [true, 'Original audio URL is required'],
            trim: true,
        },

        /**
         * AI-generated summary of the voice note. Not required at creation
         * time: a note is first persisted when the audio arrives, and the
         * summary is filled in once the AI job completes.
         */
        summary: {
            type: String,
            trim: true,
            default: '',
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
 * Compound index for the most common list query:
 * "give me this user's notes in this folder, newest first".
 */
voiceNoteSchema.index({ userId: 1, folderId: 1, createdAt: -1 });

// Serverless-safe export (see _User.js for the rationale).
module.exports =
    mongoose.models.VoiceNote || mongoose.model('VoiceNote', voiceNoteSchema);
