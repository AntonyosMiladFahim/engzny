export function formatDuration(sec) {
    if (sec == null || Number.isNaN(Number(sec))) return null;
    const s = Math.max(0, Math.round(Number(sec)));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;

export function formatRelative(input, now = Date.now()) {
    if (!input) return '';
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return '';
    const diff = (d.getTime() - now) / 1000;
    const abs = Math.abs(diff);
    if (abs < 45) return 'just now';
    if (abs < 3600) return rtf ? rtf.format(Math.round(diff / 60), 'minute') : `${Math.round(abs / 60)}m ago`;
    if (abs < 86400) return rtf ? rtf.format(Math.round(diff / 3600), 'hour') : `${Math.round(abs / 3600)}h ago`;
    if (abs < 86400 * 7) return rtf ? rtf.format(Math.round(diff / 86400), 'day') : `${Math.round(abs / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function initials(name = '') {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (/^\+?\d[\d\s-]+$/.test(name)) return '#';
    return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

/**
 * Render a WhatsApp chat id as something a person can read.
 * `201001234567@c.us` → `+201001234567`. Group ids, `@lid` ids and anything
 * that is not phone-shaped come back as-is, because inventing a `+` in front
 * of an opaque identifier would be a lie.
 */
export function contactHandle(senderId) {
    if (typeof senderId !== 'string') return null;
    const id = senderId.trim();
    if (!id) return null;

    const at = id.lastIndexOf('@');
    if (at === -1) return /^\d{6,20}$/.test(id) ? `+${id}` : id;

    const suffix = id.slice(at).toLowerCase();
    if (suffix !== '@c.us' && suffix !== '@s.whatsapp.net') return id;

    const local = id.slice(0, at).split(':')[0];
    return /^\d{6,20}$/.test(local) ? `+${local}` : id;
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split `text` into `{ text, hit }` runs so a match can be wrapped in <mark>.
 *
 * Query words are matched independently (the backend's `$text` search is
 * OR-based across terms, so the highlighter mirrors that), single characters
 * are ignored to stop the whole card lighting up on the first keystroke, and
 * adjacent runs of the same kind are merged to keep the DOM small.
 *
 * @param {string} text
 * @param {string} query
 * @returns {{text: string, hit: boolean}[]}
 */
export function highlightParts(text, query) {
    const source = String(text ?? '');
    const terms = String(query ?? '')
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 1)
        .map(escapeRegex);

    if (!source || !terms.length) return [{ text: source, hit: false }];

    // One capture group ⇒ String.split alternates [miss, hit, miss, hit, …],
    // so parity tells us what each chunk is without re-running the regex.
    const chunks = source.split(new RegExp(`(${terms.join('|')})`, 'gi'));
    const out = [];
    chunks.forEach((chunk, i) => {
        if (!chunk) return;
        const hit = i % 2 === 1;
        const prev = out[out.length - 1];
        if (prev && prev.hit === hit) prev.text += chunk;
        else out.push({ text: chunk, hit });
    });
    return out.length ? out : [{ text: source, hit: false }];
}

/**
 * Does this note satisfy the live query?
 *
 * Deliberately mirrors MongoDB's `$text` semantics: terms are ORed, so a note
 * carrying any one of them is a real hit. Keeping the two in step means the
 * optimistic client-side pass (rendered during the debounce, over the results
 * we already hold) and the server's own answer agree — the grid narrows once
 * and stays put instead of reshuffling when the response lands.
 *
 * Applied *on top of* the server's result set, so it can only ever remove a
 * row the user can see no reason for, never invent one.
 */
export function matchesQuery(note, query) {
    const terms = String(query ?? '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    if (!terms.length) return true;

    const haystack = [note.sender, note.title, note.summary, note.transcript, ...(note.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return terms.some((t) => haystack.includes(t));
}


/** Deterministic pseudo-waveform so cards look stable across renders. */
export function waveformFor(seed = '', bars = 18) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = (h ^ seed.charCodeAt(i)) * 16777619;
    const out = [];
    for (let i = 0; i < bars; i++) {
        h = (h * 1103515245 + 12345) & 0x7fffffff;
        out.push(0.25 + (h % 1000) / 1000 * 0.75);
    }
    return out;
}
