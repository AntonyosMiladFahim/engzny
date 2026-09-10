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
         * Optional BatchAnalysis ID if this voice note was created as part of
         * a bulk chat analysis. `null` == regular inbox / uploaded note.
         */
        batchId: {
            type: Schema.Types.ObjectId,
            ref: 'BatchAnalysis',
            default: null,
            index: true,
        },

        /**
         * WhatsApp chat id of whoever sent the voice note – e.g.
         * `201001234567@c.us`. This is the *stable* grouping key for the
         * Contacts rail: display names change, the id does not.
         *
         * For a group chat we store the participant (the actual human) rather
         * than the group id, so "Contacts" always means people.
         *
         * `null` for notes that arrived through the PWA share target, where
         * there is no WhatsApp sender at all.
         */
        senderId: {
            type: String,
            trim: true,
            default: null,
        },

        /**
         * The sender's WhatsApp display name at the time the note arrived
         * (`_data.notifyName` on the WEBJS engine, `pushName` on NOWEB).
         *
         * Deliberately allowed to be empty: WhatsApp does not always give us a
         * name, and storing a synthesised "+2010…" here would go stale the
         * moment the real name shows up. Read-side code resolves the fallback
         * chain via `_utils/_contact.displayName()`.
         */
        senderName: {
            type: String,
            trim: true,
            default: '',
        },

        /**
         * Message content type: 'audio' for voice notes, 'text' for text messages.
         */
        messageType: {
            type: String,
            enum: ['audio', 'text'],
            default: 'audio',
        },

        /**
         * Location of raw audio (for audio notes). Null for plain text messages.
         */
        originalAudioUrl: {
            type: String,
            trim: true,
            default: null,
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

        /**
         * Verbatim transcript of the spoken words, in the original language.
         * Produced by the AI alongside the summary. Stored separately so the
         * UI can offer both a clean readable digest (summary) and the raw
         * words for accuracy verification or copy-paste. Optional: left empty
         * when the AI cannot determine the spoken content.
         */
        transcript: {
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

/**
 * Same shape, keyed by contact: backs both `GET /api/notes?sender=…` and the
 * `$group` stage of `GET /api/notes/contacts`.
 */
voiceNoteSchema.index({ userId: 1, senderId: 1, createdAt: -1 });

/**
 * Compound TEXT index powering the deep search (`?search=`).
 *
 *   - MongoDB allows exactly ONE text index per collection, which is why both
 *     searchable fields live in this single compound declaration rather than
 *     in two separate indexes.
 *   - `weights` make a hit on the contact's name outrank a passing mention of
 *     the same word inside a summary, so "mariam" surfaces Mariam's notes
 *     before a note that merely says "ask mariam about it".
 *   - `default_language: 'none'` disables stemming and stop-word removal.
 *     Summaries here are routinely Arabic (or code-switched Arabic/English),
 *     which the English analyser would mangle: it would strip Arabic-adjacent
 *     tokens it mistakes for stop words and stem English words in ways that
 *     hurt exact-name matching. The route layer keeps a regex fallback for the
 *     partial-word / prefix cases a text index cannot serve.
 */
voiceNoteSchema.index(
    { senderName: 'text', transcript: 'text', summary: 'text' },
    {
        name: 'voicenote_search',
        weights: { senderName: 8, transcript: 6, summary: 4 },
        default_language: 'none',
    }
);

// Serverless-safe export (see _User.js for the rationale).
module.exports =
    mongoose.models.VoiceNote || mongoose.model('VoiceNote', voiceNoteSchema);
