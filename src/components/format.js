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
