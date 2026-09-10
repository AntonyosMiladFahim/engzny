/**
 * api/_utils/_contact.js
 * ------------------------------------------------------------------
 * Pure helpers for turning WhatsApp chat identifiers into something a human
 * can read, plus the tiny regex-escaping utility the notes search falls back
 * on. No I/O, no Mongoose – trivially unit-testable.
 *
 * WhatsApp / WAHA identifier shapes we see in the wild:
 *   201001234567@c.us              – 1:1 chat (WEBJS engine)
 *   201001234567@s.whatsapp.net    – 1:1 chat (NOWEB engine)
 *   201001234567:12@s.whatsapp.net – same, with a device suffix
 *   120363000000000000@g.us        – group chat (the *chat*, not a person)
 *   123456789012345@lid            – privacy-preserving linked id (NOT a phone)
 *   status@broadcast               – status updates
 *
 * File (and its directory) is prefixed with `_` so Vercel does NOT treat it as
 * an HTTP route.
 * ------------------------------------------------------------------
 */

/** Suffix that marks a group chat rather than an individual. */
const GROUP_SUFFIX = '@g.us';

/**
 * Suffixes whose local part is a real, dialable phone number. `@lid` is
 * deliberately absent: it looks like digits but is an opaque WhatsApp id, and
 * rendering it as "+123456789012345" would be a lie.
 */
const PHONE_SUFFIXES = ['@c.us', '@s.whatsapp.net'];

/** Shown when we have neither a push name nor a dialable number. */
const UNKNOWN_CONTACT = 'Unknown Contact';

/**
 * Coerce anything WAHA hands us into a trimmed chat-id string.
 * WAHA occasionally sends `{ _serialized: '...@c.us' }` instead of a string.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function chatId(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (value && typeof value === 'object') {
        return chatId(value._serialized ?? value.id ?? value.user ?? null);
    }
    return null;
}

/**
 * @param {unknown} value
 * @returns {boolean} true when the id addresses a group chat
 */
function isGroupChat(value) {
    const id = chatId(value);
    return Boolean(id) && id.toLowerCase().endsWith(GROUP_SUFFIX);
}

/**
 * Extract the dialable phone number from a chat id, or null when the id is
 * not phone-shaped (groups, `@lid`, broadcasts, malformed input).
 *
 * @param {unknown} value
 * @returns {string|null} digits only, e.g. "201001234567"
 */
function phoneFromChatId(value) {
    const id = chatId(value);
    if (!id) return null;

    const at = id.lastIndexOf('@');
    if (at === -1) return /^\d{6,20}$/.test(id) ? id : null;

    const suffix = id.slice(at).toLowerCase();
    if (!PHONE_SUFFIXES.includes(suffix)) return null;

    // Strip a `:device` part before the domain.
    const local = id.slice(0, at).split(':')[0];
    return /^\d{6,20}$/.test(local) ? local : null;
}

/**
 * Human-facing rendering of a chat id: "+201001234567" for real numbers, the
 * raw id for anything else (so the UI still shows *something* stable).
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function formatHandle(value) {
    const phone = phoneFromChatId(value);
    if (phone) return `+${phone}`;
    // Return null for any id that isn't a real dialable number — this includes
    // @lid (opaque privacy ids), @g.us groups, @broadcast, and anything else
    // non-phone-shaped. The UI suppresses the subtitle DOM element on null.
    return null;
}

/**
 * The single source of truth for "what do we call this contact?".
 * Push name → phone number → "Unknown Contact", per the resilience rule.
 *
 * @param {unknown} senderName stored WhatsApp push/notify name (may be empty)
 * @param {unknown} senderId   stored chat id (may be null)
 * @returns {string}
 */
function displayName(senderName, senderId) {
    if (typeof senderName === 'string' && senderName.trim()) {
        return senderName.trim();
    }
    return formatHandle(senderId) || UNKNOWN_CONTACT;
}

/**
 * Escape a user-supplied string for safe embedding in a RegExp. Used by the
 * `$text` fallback path in /api/notes, which must never let a stray `(` or
 * `*` blow up (or hang) the query.
 *
 * @param {string} input
 * @returns {string}
 */
function escapeRegex(input) {
    return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    GROUP_SUFFIX,
    PHONE_SUFFIXES,
    UNKNOWN_CONTACT,
    chatId,
    isGroupChat,
    phoneFromChatId,
    formatHandle,
    displayName,
    escapeRegex,
};
