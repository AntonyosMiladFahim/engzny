/**
 * src/components/dashboard/ShareRoutingModal.jsx
 * ------------------------------------------------------------------
 * Full-screen intercept modal that appears when the PWA share inbox
 * has pending audio items. Forces the user to route each item to a
 * specific WhatsApp chat before it is uploaded and summarised.
 *
 * Flow (one item at a time):
 *   1. Fetch first page of /api/waha/chats (?limit=25&offset=0).
 *   2. Merge with contacts already known from the DB (so previously-
 *      seen senders always appear, even if not in the live WAHA list).
 *   3. User picks a chat → POST /api/ai/upload with senderId + senderName
 *      → inbox.delete() → next item.
 *   4. "Skip" → upload with no senderId → inbox.delete() → next item.
 *   5. "Load more" → fetch next page and append to list.
 *   6. When all items are processed, call props.onComplete().
 * ------------------------------------------------------------------
 */

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Link2Off, Loader2, Mic, Search, SkipForward, X } from 'lucide-react';
import api from '../../services/api';
import { initials, contactHandle } from '../format';
import { SPRING_SNAPPY, SPRING_SOFT } from '../motion';
import { toast } from '../ui/toast';
import Button from '../ui/Button';
import cx from '../ui/cx';

/* ── Constants ────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 25;

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Normalise a raw WAHA chat or DB contact into a unified row shape.
 * `source` lets the list render WAHA chats before DB-only contacts.
 */
function normaliseRow(raw, source = 'db') {
    const id = String(raw.id ?? raw.senderId ?? '');
    const handle = contactHandle(id);
    const name = (raw.name ?? raw.senderName ?? '').trim() || handle || 'Unknown Contact';
    return {
        id,
        name,
        handle: handle && handle !== name ? handle : null,
        picture: raw.picture ?? null,
        lastMessage: raw.lastMessage ?? null,
        source,
    };
}

/** Trailing-edge debounce. */
function useDebounced(value, delay = 140) {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        if (value === settled) return;
        const t = setTimeout(() => setSettled(value), delay);
        return () => clearTimeout(t);
    }, [value, delay, settled]);
    return settled;
}

/* ── Avatar ───────────────────────────────────────────────────────────────── */

function Avatar({ name, picture, size = 44 }) {
    const [imgError, setImgError] = useState(false);
    if (picture && !imgError) {
        return (
            <img
                src={picture}
                alt=""
                onError={() => setImgError(true)}
                className="shrink-0 rounded-full object-cover"
                style={{ width: size, height: size }}
            />
        );
    }
    return (
        <span
            aria-hidden="true"
            className="grid shrink-0 place-items-center rounded-full bg-ink-700 font-mono font-bold text-verdigris-300 shadow-hairline"
            style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
        >
            {initials(name)}
        </span>
    );
}

/* ── Chat row ─────────────────────────────────────────────────────────────── */

function ChatRow({ row, onSelect }) {
    return (
        <motion.li layout="position" transition={SPRING_SNAPPY}>
            <button
                type="button"
                onClick={() => onSelect(row)}
                className="group/row relative flex w-full items-center gap-3.5 rounded-2xl px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-signal-400/60 active:scale-[0.985]"
            >
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-2xl bg-white/[0.035] opacity-0 transition-opacity duration-150 group-hover/row:opacity-100"
                />
                <Avatar name={row.name} picture={row.picture} size={44} />
                <span className="relative min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                        <span className="block truncate text-[14px] font-semibold leading-snug text-fog-50">
                            {row.name}
                        </span>
                        {row.lastMessage?.timestamp && (
                            <span className="shrink-0 font-mono text-[10.5px] text-fog-600">
                                {new Date(row.lastMessage.timestamp * 1000).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </span>
                        )}
                    </span>
                    <span className="mt-[3px] block truncate text-[12.5px] leading-none text-fog-500">
                        {row.lastMessage?.body ?? row.handle ?? ''}
                    </span>
                </span>
            </button>
        </motion.li>
    );
}

/* ── "Load more" button ───────────────────────────────────────────────────── */

/**
 * Uses the project's canonical Button component (variant="ghost") so the
 * style is automatically consistent with the rest of the design system.
 * The Button's built-in Loader2 spinner and AnimatePresence label swap
 * handle the loading state — no extra markup needed here.
 */
function LoadMoreButton({ onLoadMore, loading }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING_SNAPPY}
            className="flex justify-center px-3 pb-2 pt-1"
        >
            <Button
                variant="ghost"
                loading={loading}
                loadingLabel="Loading chats…"
                icon={null}
                onClick={onLoadMore}
                disabled={loading}
                className="h-9 w-full text-[12px] tracking-[0.04em]"
            >
                Load older chats
            </Button>
        </motion.div>
    );
}

/* ── Main modal ───────────────────────────────────────────────────────────── */

/**
 * @param {object}   props
 * @param {object[]} props.items     Pending share-inbox items
 * @param {object[]} props.contacts  Already-known contacts from useContacts()
 * @param {Function} props.onComplete Called when all items have been processed
 */
export default function ShareRoutingModal({ items, contacts, onComplete }) {
    const reduce = useReducedMotion();

    // ── Items queue ──────────────────────────────────────────────────────────
    const [queue, setQueue] = useState(items);
    const current = queue[0] ?? null;
    const remaining = queue.length;

    // ── WAHA chat pagination ─────────────────────────────────────────────────
    const [wahaChats, setWahaChats] = useState([]);
    const [connected, setConnected] = useState(true);
    const [chatsLoading, setChatsLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [offset, setOffset] = useState(0);

    /**
     * Fetch one page of chats from the backend and either initialise or
     * append to the existing list.
     */
    const fetchPage = useCallback(async (pageOffset, append = false) => {
        const setter = append ? setLoadingMore : setChatsLoading;
        setter(true);
        try {
            const res = await api.get('/waha/chats', {
                params: { limit: PAGE_SIZE, offset: pageOffset },
            });
            const { chats = [], hasMore: more = false, connected: conn = false } = res.data;
            setConnected(conn);
            setWahaChats((prev) => append ? [...prev, ...chats] : chats);
            // Relax the heuristic: show "Load more" as long as this page
            // returned at least one row. The previous `=== limit` check was
            // too strict — WAHA may return fewer rows than the page size even
            // when more exist (e.g. filtered out on their end). The button
            // will naturally disappear once a page returns 0 rows.
            setHasMore(chats.length > 0);
            setOffset(pageOffset + chats.length);
        } catch {
            setConnected(false);
        } finally {
            setter(false);
        }
    }, []);

    // Initial load on mount.
    useEffect(() => { fetchPage(0, false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleLoadMore = useCallback(() => {
        if (loadingMore || !hasMore) return;
        fetchPage(offset, true);
    }, [fetchPage, hasMore, loadingMore, offset]);

    // ── Merged, deduplicated rows ────────────────────────────────────────────
    const rows = useMemo(() => {
        const waha = wahaChats.map((c) => normaliseRow(c, 'waha'));
        const seenIds = new Set(waha.map((r) => r.id));
        const db = (contacts ?? [])
            .filter((c) => c.id && !seenIds.has(c.id))
            .map((c) => normaliseRow(c, 'db'));
        return [...waha, ...db].filter((r) => r.id);
    }, [wahaChats, contacts]);

    // ── Search ───────────────────────────────────────────────────────────────
    const [query, setQuery] = useState('');
    const debouncedQuery = useDebounced(query);
    const searchRef = useRef(null);

    const filtered = useMemo(() => {
        const q = debouncedQuery.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(
            (r) =>
                r.name.toLowerCase().includes(q) ||
                (r.handle ?? '').toLowerCase().includes(q)
        );
    }, [rows, debouncedQuery]);

    // Focus search when chats are ready.
    useEffect(() => {
        if (!chatsLoading) setTimeout(() => searchRef.current?.focus(), 120);
    }, [chatsLoading]);

    // ── Upload logic ─────────────────────────────────────────────────────────
    const [uploading, setUploading] = useState(false);

    const processItem = useCallback(
        async (item, senderId, senderName) => {
            setUploading(true);
            try {
                const fullItem = await window.engzny.shareInbox.take(item.id);
                if (!fullItem?.blob) throw new Error('No audio in inbox item');
                const buffer = await fullItem.blob.arrayBuffer();
                const base64 = btoa(
                    new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), '')
                );
                await api.post('/ai/upload', {
                    audioBase64: base64,
                    mimeType: fullItem.type || 'audio/ogg',
                    // Use the file's lastModified date if available (ms since epoch),
                    // so the note is filed under when the audio was actually created
                    // rather than the server's insertion time.
                    timestamp: fullItem.blob?.lastModified ?? Date.now(),
                    ...(senderId ? { senderId, senderName } : {}),
                });
                await window.engzny.shareInbox.delete(item.id);
            } catch (err) {
                toast.error(err.message || 'Upload failed', {
                    key: 'share-route-err',
                    title: 'Could not upload voice note',
                });
            } finally {
                setUploading(false);
            }
            setQueue((prev) => {
                const next = prev.slice(1);
                if (next.length === 0) onComplete();
                return next;
            });
        },
        [onComplete]
    );

    const handleSelect = useCallback(
        (row) => processItem(current, row.id, row.name),
        [current, processItem]
    );
    const handleSkip = useCallback(
        () => processItem(current, null, null),
        [current, processItem]
    );

    if (!current) return null;

    /* ── Render ──────────────────────────────────────────────────────────── */
    return createPortal(
        <AnimatePresence>
            {/* Backdrop */}
            <motion.div
                key="share-modal-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="fixed inset-0 z-[60] bg-ink-950/80 backdrop-blur-md"
                aria-hidden="true"
            />

            {/* Sheet */}
            <motion.div
                key="share-modal-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Route voice note to a contact"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 32, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
                transition={SPRING_SOFT}
                className="glass fixed inset-x-4 top-1/2 z-[61] mx-auto flex max-h-[82dvh] max-w-lg -translate-y-1/2 flex-col rounded-4xl shadow-glass"
                style={{ transform: 'translateY(-50%)' }}
            >
                {/* Header */}
                <header className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="grid h-8 w-8 place-items-center rounded-xl bg-signal-400/[0.12] text-signal-400">
                                <Mic aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                            </span>
                            <h2 className="text-[16px] font-bold tracking-[-0.02em] text-fog-50">
                                Who sent this?
                            </h2>
                        </div>
                        {remaining > 1 && (
                            <p className="mt-1 font-mono text-[11px] text-fog-500">
                                {remaining} voice notes to route
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={handleSkip}
                        disabled={uploading}
                        title="Assign to no one and upload anyway"
                        className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fog-500 transition-colors duration-150 hover:bg-white/[0.05] hover:text-fog-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60 disabled:opacity-40"
                    >
                        <SkipForward aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
                        Skip
                    </button>
                </header>

                {/* Search */}
                <div className="shrink-0 px-4 pb-3">
                    <label className="group/search relative flex h-10 items-center">
                        <span className="sr-only">Search chats</span>
                        <Search
                            aria-hidden="true"
                            strokeWidth={1.75}
                            className="pointer-events-none absolute left-3 h-4 w-4 text-fog-600 transition-colors duration-150 group-focus-within/search:text-signal-400"
                        />
                        <input
                            ref={searchRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search chats…"
                            autoComplete="off"
                            spellCheck="false"
                            className="h-full w-full rounded-xl bg-white/[0.04] pl-9 pr-8 text-[13.5px] text-fog-100 shadow-hairline outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-fog-600 focus:bg-white/[0.06] focus:shadow-focus"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                className="absolute right-2 grid h-6 w-6 place-items-center rounded-md text-fog-500 hover:text-fog-200"
                            >
                                <X aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
                            </button>
                        )}
                    </label>
                </div>

                {/* Scrollable list */}
                <div
                    className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-width:thin]"
                    style={{
                        maskImage:
                            'linear-gradient(to bottom, transparent 0, black 8px, black calc(100% - 12px), transparent 100%)',
                        WebkitMaskImage:
                            'linear-gradient(to bottom, transparent 0, black 8px, black calc(100% - 12px), transparent 100%)',
                    }}
                >
                    {/* Skeleton */}
                    {chatsLoading && (
                        <ul className="flex flex-col gap-1 py-2" aria-hidden="true">
                            {[0.7, 0.55, 0.65, 0.5, 0.6].map((w, i) => (
                                <li key={i} className="flex h-[60px] items-center gap-3.5 px-3">
                                    <span className="h-11 w-11 shrink-0 rounded-full bg-white/[0.06]" />
                                    <span className="flex-1 space-y-2">
                                        <span className="block h-3 rounded bg-white/[0.07]" style={{ width: `${w * 100}%` }} />
                                        <span className="block h-2.5 rounded bg-white/[0.04]" style={{ width: `${w * 60}%` }} />
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Not connected */}
                    {!chatsLoading && !connected && rows.length === 0 && (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <Link2Off aria-hidden="true" className="h-8 w-8 text-fog-600" strokeWidth={1.5} />
                            <p className="text-[13.5px] leading-relaxed text-fog-400">
                                WhatsApp isn't linked yet.{' '}
                                <span className="text-fog-300">
                                    Click Skip to save without a sender, or link first.
                                </span>
                            </p>
                        </div>
                    )}

                    {/* Empty search */}
                    {!chatsLoading && rows.length > 0 && filtered.length === 0 && (
                        <p className="px-3 py-6 text-center text-[13px] text-fog-500">
                            No chats match "<span className="text-fog-300">{query.trim()}</span>"
                        </p>
                    )}

                    {/* Chat rows */}
                    {!chatsLoading && filtered.length > 0 && (
                        <motion.ul
                            className="flex flex-col gap-0.5 py-1"
                            initial="hidden"
                            animate="show"
                            variants={{
                                hidden: {},
                                show: { transition: { staggerChildren: 0.025 } },
                            }}
                        >
                            {filtered.map((row) => (
                                <motion.div
                                    key={row.id}
                                    variants={
                                        reduce
                                            ? undefined
                                            : {
                                                  hidden: { opacity: 0, x: -8 },
                                                  show: { opacity: 1, x: 0, transition: SPRING_SNAPPY },
                                              }
                                    }
                                >
                                    <ChatRow row={row} onSelect={handleSelect} />
                                </motion.div>
                            ))}
                        </motion.ul>
                    )}

                    {/*
                      * "Load more" — only visible when:
                      *   1. The initial load is done (no skeleton).
                      *   2. Search is empty (pagination makes no sense while filtering).
                      *   3. The backend says there are more rows (hasMore).
                      */}
                    {!chatsLoading && !debouncedQuery && hasMore && (
                        <LoadMoreButton onLoadMore={handleLoadMore} loading={loadingMore} />
                    )}
                </div>

                {/* Uploading overlay */}
                <AnimatePresence>
                    {uploading && (
                        <motion.div
                            key="uploading"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-4xl bg-ink-900/75 backdrop-blur-sm"
                        >
                            <Loader2 className="h-8 w-8 animate-spin-slow text-signal-400" strokeWidth={1.75} />
                            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-fog-400">
                                Summarising…
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </AnimatePresence>,
        document.body
    );
}
