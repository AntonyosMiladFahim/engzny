/**
 * api/_routes/_notes.js
 * ------------------------------------------------------------------
 * Read side of the library.
 *
 *   GET /api/notes/contacts        unique senders for the current tenant
 *   GET /api/notes                 ?folder= ?sender= ?search= ?limit=
 *
 * Every query is scoped by `req.user._id` before anything else is applied, so
 * no combination of query parameters can reach another tenant's notes.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const express = require('express');
const mongoose = require('mongoose');

const requireAuth = require('../_middlewares/_authMiddleware');
const VoiceNote = require('../_models/_VoiceNote');
const connectDB = require('../_config/_db');
const { displayName, formatHandle, escapeRegex } = require('../_utils/_contact');

const router = express.Router();

/** Hard ceiling on a single page of notes – protects the lambda's memory. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 200;

/** Most contacts we will hand the sidebar in one go. */
const MAX_CONTACTS = 300;

/** MongoDB's error code for "$text used without a text index". */
const ERR_NO_TEXT_INDEX = 27;

/**
 * Shape a lean VoiceNote document for the client.
 *
 * `originalAudioUrl` is deliberately omitted: it is a `data:` URI holding the
 * entire base64 audio, so echoing it back would put megabytes on the wire for
 * every keystroke of the debounced deep search. Nothing in the frontend reads
 * it; `hasAudio` preserves the one bit of information the UI could want.
 *
 * @param {object} n lean VoiceNote (folderId optionally populated)
 * @returns {object}
 */
function serializeNote(n) {
    const folder = n.folderId && typeof n.folderId === 'object' ? n.folderId : null;

    return {
        _id: n._id,
        id: String(n._id),
        summary: n.summary ?? '',
        senderId: n.senderId ?? null,
        senderName: n.senderName ?? '',
        // Pre-resolved so every surface (card, drawer, export) agrees on the
        // name without re-implementing the fallback chain.
        sender: displayName(n.senderName, n.senderId),
        folderId: folder ? folder._id : n.folderId ?? null,
        folder: folder ? { _id: folder._id, id: String(folder._id), name: folder.name } : null,
        folderName: folder ? folder.name : null,
        hasAudio: Boolean(n.originalAudioUrl),
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        ...(n.score != null ? { score: n.score } : {}),
    };
}

/**
 * Parse `?limit=` into a sane integer.
 * @param {unknown} raw
 * @returns {number}
 */
function parseLimit(raw) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
}

/**
 * Run the deep search.
 *
 * Two-tier on purpose:
 *
 *   1. `$text` against the `voicenote_search` compound index. This is the fast
 *      path and the one that ranks: results come back ordered by relevance
 *      (senderName weighted 8, summary 4) rather than by date.
 *   2. A case-insensitive regex fallback, used when `$text` finds nothing.
 *      A text index only matches whole tokens, so a user typing "ven" mid-word
 *      would otherwise watch the grid empty out before "venue" completes. The
 *      fallback also covers a cluster whose index has not finished building.
 *
 * @param {object} base   tenant-scoped filter (userId, folderId, senderId…)
 * @param {string} search raw user input, already trimmed and non-empty
 * @param {number} limit
 * @returns {Promise<object[]>} lean documents
 */
async function searchNotes(base, search, limit) {
    const project = { score: { $meta: 'textScore' } };

    try {
        const ranked = await VoiceNote.find({ ...base, $text: { $search: search } }, project)
            .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
            .limit(limit)
            .populate('folderId', 'name')
            .lean();

        if (ranked.length > 0) return ranked;
    } catch (err) {
        // A missing text index is a deployment state, not a client error –
        // degrade to regex rather than 500ing the dashboard.
        if (err?.code !== ERR_NO_TEXT_INDEX && !/text index required/i.test(err?.message || '')) {
            throw err;
        }
        console.warn('[notes] text index unavailable, falling back to regex search');
    }

    const rx = new RegExp(escapeRegex(search), 'i');
    return VoiceNote.find({ ...base, $or: [{ summary: rx }, { senderName: rx }] })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('folderId', 'name')
        .lean();
}

/**
 * GET /api/notes/contacts
 *
 * Unique senders across the tenant's notes, newest conversation first.
 * Declared before `GET /` purely for readability – the paths do not collide.
 */
router.get('/contacts', requireAuth, async (req, res) => {
    try {
        await connectDB();

        const rows = await VoiceNote.aggregate([
            // Notes shared straight into the PWA have no WhatsApp sender at
            // all; they belong in "All notes", not in the Contacts rail.
            { $match: { userId: req.user._id, senderId: { $type: 'string', $ne: '' } } },
            // Ascending so `$last` below means "the most recent name we saw".
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: '$senderId',
                    latestName: { $last: '$senderName' },
                    // Keeps an older name usable when the newest note happened
                    // to arrive without one.
                    names: { $addToSet: '$senderName' },
                    count: { $sum: 1 },
                    lastNoteAt: { $max: '$createdAt' },
                },
            },
            { $sort: { lastNoteAt: -1 } },
            { $limit: MAX_CONTACTS },
        ]);

        const contacts = rows.map((row) => {
            const known =
                (typeof row.latestName === 'string' && row.latestName.trim() && row.latestName) ||
                (row.names || []).find((n) => typeof n === 'string' && n.trim()) ||
                '';

            return {
                senderId: row._id,
                id: row._id,
                senderName: known,
                name: displayName(known, row._id),
                handle: formatHandle(row._id),
                count: row.count,
                lastNoteAt: row.lastNoteAt,
            };
        });

        res.json({ contacts });
    } catch (err) {
        console.error('[notes] GET /contacts failed:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * GET /api/notes
 *
 * Query params (all optional, all combinable):
 *   folder  ObjectId  – only notes filed into this folder
 *   sender  string    – only notes from this WhatsApp chat id
 *   search  string    – deep text search over senderName + summary
 *   limit   number    – page size, capped at MAX_LIMIT
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        await connectDB();

        const query = { userId: req.user._id };

        if (req.query.folder) {
            if (!mongoose.isValidObjectId(req.query.folder)) {
                return res.status(400).json({ message: 'Invalid folder ID' });
            }
            query.folderId = req.query.folder;
        }

        if (typeof req.query.sender === 'string' && req.query.sender.trim()) {
            query.senderId = req.query.sender.trim();
        }

        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const limit = parseLimit(req.query.limit);

        const notes = search
            ? await searchNotes(query, search, limit)
            : await VoiceNote.find(query)
                  .sort({ createdAt: -1 })
                  .limit(limit)
                  .populate('folderId', 'name')
                  .lean();

        res.json({ notes: notes.map(serializeNote), query: { search, limit } });
    } catch (err) {
        console.error('[notes] GET failed:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
