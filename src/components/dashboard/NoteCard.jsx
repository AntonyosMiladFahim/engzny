/**
 * src/components/dashboard/NoteCard.jsx
 * ------------------------------------------------------------------
 * A voice-note summary card. Weight is communicated through motion: a
 * pointer-driven 3.5° tilt with a following sheen (desktop only), a 3px lift
 * on hover and a 0.8% compress on press.
 *
 * `query` is the live deep-search term; matches are marked in the sender line
 * and the summary.
 *
 * `onSelectContact` — fires with `note.senderId` when the sender name/avatar
 * is clicked. Notes with no senderId keep a plain label.
 *
 * `onDelete` — fires with `note.id` after the note has been successfully
 * deleted from the server. NotesGrid optimistically removes the card.
 *
 * AUDIO PLAYER
 * ------------
 * When `note.hasAudio` is true a Play/Pause button overlays the waveform.
 * Clicking it creates a single HTMLAudioElement whose src is set lazily to
 * `/api/notes/{id}/audio` (the dedicated streaming endpoint — no base64 is
 * ever served to the bulk fetch). The waveform bars pulse in sync while audio
 * plays by reading `audioRef.currentTime` on a rAF loop.
 *
 * RTL TEXT
 * --------
 * `dir="auto"` is applied to the summary and transcript paragraphs so the
 * browser's bidi algorithm aligns Arabic text right and English text left
 * without any hardcoded direction.
 * ------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Pause, Play, Trash2 } from 'lucide-react';
import useTilt from '../../hooks/useTilt';
import cx from '../ui/cx';
import Highlight from '../ui/Highlight';
import { collapse, riseSoft, SPRING_SNAPPY } from '../motion';
import { formatDuration, formatRelative, initials, waveformFor } from '../format';
import { toast } from '../ui/toast';
import api from '../../services/api';

/* -------------------------------------------------------------------------- */
/*  Inline delete confirm                                                      */
/* -------------------------------------------------------------------------- */

function DeleteConfirm({ onConfirm, onCancel, loading }) {
    return (
        <motion.div
            key="confirm"
            initial={{ opacity: 0, scale: 0.85, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: -4 }}
            transition={SPRING_SNAPPY}
            className="flex items-center gap-1.5"
        >
            <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                aria-label="Cancel delete"
                className="grid h-7 w-7 place-items-center rounded-lg text-fog-500 transition-colors duration-150 hover:bg-white/[0.06] hover:text-fog-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60 disabled:opacity-40"
            >
                <span className="text-[13px] font-bold">✕</span>
            </button>
            <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                aria-label="Confirm delete"
                className="flex h-7 items-center gap-1.5 rounded-lg bg-ember-500/[0.15] px-2.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-ember-300 ring-1 ring-ember-400/25 transition-[background-color,opacity] duration-150 hover:bg-ember-500/[0.25] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400/60 disabled:opacity-40"
            >
                {loading ? (
                    <span className="h-3 w-3 animate-spin-slow rounded-full border-2 border-ember-400/30 border-t-ember-400" />
                ) : (
                    <Trash2 aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
                )}
                Delete
            </button>
        </motion.div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Audio player hook                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Manages a single HTMLAudioElement per note.
 *
 * SECURE FETCHING
 * ---------------
 * Native browser `<audio>` elements and `new Audio(url)` do NOT attach the
 * JWT `Authorization` header, so a direct URL to `/api/notes/:id/audio` always
 * returns 401. Instead we:
 *   1. Fetch the bytes via Axios (which attaches the Bearer token automatically).
 *   2. Wrap the response Blob in a local object URL.
 *   3. Pass that object URL to `new Audio(url)` — the browser plays from the
 *      same-origin blob: URL without any additional auth.
 *   4. Revoke the object URL on unmount to free memory.
 *
 * The fetch is lazy: it only fires the first time the user taps Play, so cards
 * that are never played don't incur any network cost.
 *
 * Returns { isPlaying, isLoading, progress, toggle }
 *   isLoading — true while the first authenticated fetch is in flight.
 *   progress  — 0–1, updated on a rAF loop while playing.
 */
function useAudioPlayer(noteId, hasAudio) {
    const audioRef   = useRef(null);
    const blobUrlRef = useRef(null); // held so we can revoke on unmount
    const rafRef     = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [progress,  setProgress]  = useState(0);

    const onPlay  = useCallback(() => setIsPlaying(true),  []);
    const onPause = useCallback(() => setIsPlaying(false), []);
    const onEnded = useCallback(() => { setIsPlaying(false); setProgress(0); }, []);

    // rAF loop: tick progress while playing.
    useEffect(() => {
        if (!isPlaying) { cancelAnimationFrame(rafRef.current); return; }
        const tick = () => {
            const el = audioRef.current;
            if (el && el.duration) setProgress(el.currentTime / el.duration);
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [isPlaying]);

    // Cleanup on unmount: pause, detach events, revoke blob URL.
    useEffect(() => {
        return () => {
            cancelAnimationFrame(rafRef.current);
            const el = audioRef.current;
            if (el) {
                el.pause();
                el.removeEventListener('play',  onPlay);
                el.removeEventListener('pause', onPause);
                el.removeEventListener('ended', onEnded);
            }
            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const toggle = useCallback(async () => {
        if (!hasAudio || isLoading) return;

        // If we already have a loaded element, just play/pause.
        if (audioRef.current) {
            const el = audioRef.current;
            el.paused ? el.play().catch(() => {}) : el.pause();
            return;
        }

        // ── First play: authenticated fetch → blob → object URL ──────────
        setIsLoading(true);
        try {
            const res = await api.get(`/notes/${noteId}/audio`, { responseType: 'blob' });
            const url  = URL.createObjectURL(res.data);
            blobUrlRef.current = url;

            const el   = new Audio(url);
            el.preload  = 'auto';
            el.addEventListener('play',  onPlay);
            el.addEventListener('pause', onPause);
            el.addEventListener('ended', onEnded);
            el.addEventListener('error', () => {
                toast.error('Playback failed.', { key: `audio-${noteId}`, title: 'Playback error' });
                setIsPlaying(false);
            });
            audioRef.current = el;
            await el.play();
        } catch (err) {
            toast.error(err?.message || 'Could not load audio.', { key: `audio-${noteId}`, title: 'Playback error' });
        } finally {
            setIsLoading(false);
        }
    }, [noteId, hasAudio, isLoading, onPlay, onPause, onEnded]);

    return { isPlaying, isLoading, progress, toggle };
}

/* -------------------------------------------------------------------------- */
/*  NoteCard                                                                   */
/* -------------------------------------------------------------------------- */

export default function NoteCard({
    note,
    expanded = false,
    onToggle,
    query = '',
    onSelectContact,
    onDelete,
}) {
    const reduce = useReducedMotion();
    const tilt = useTilt();
    const bars = useMemo(() => waveformFor(note.id, 22), [note.id]);
    const hasMore = Boolean(note.transcript) || (note.summary?.length ?? 0) > 180;

    const term = query.trim();
    const matchedDeep = useMemo(() => {
        if (term.length < 2) return false;
        const head = (note.summary ?? '').slice(0, 140).toLowerCase();
        return (note.summary ?? '').toLowerCase().includes(term.toLowerCase()) && !head.includes(term.toLowerCase());
    }, [note.summary, term]);
    const open = expanded || matchedDeep;

    // ── Delete state machine ───────────────────────────────────────────────
    const [deleteState, setDeleteState] = useState('idle');

    const handleDeleteConfirm = async () => {
        setDeleteState('deleting');
        try {
            await api.delete(`/notes/${note.id}`);
            onDelete?.(note.id);
        } catch (err) {
            setDeleteState('idle');
            toast.error(err.message || 'Delete failed', { key: `del-${note.id}`, title: 'Could not delete note' });
        }
    };

    // ── Audio player ───────────────────────────────────────────────────────
    const { isPlaying, isLoading, progress, toggle: toggleAudio } = useAudioPlayer(note.id, note.hasAudio);

    // A note is "attributable" when it arrived via WhatsApp (senderId present).
    const clickableSender = Boolean(note.senderId && onSelectContact);

    return (
        <motion.article
            layout={reduce ? false : 'position'}
            variants={riseSoft}
            {...tilt.handlers}
            style={tilt.style}
            whileHover={reduce ? undefined : { y: -3 }}
            whileTap={reduce ? undefined : { scale: 0.992 }}
            transition={SPRING_SNAPPY}
            className="glass-sm group relative flex flex-col rounded-3xl p-5 will-change-transform"
        >
            <motion.span
                aria-hidden="true"
                style={tilt.sheenStyle}
                className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />

            {/* ── Delete control — top-right corner ────────────────────── */}
            {onDelete && (
                <div className="absolute right-3.5 top-3.5 z-10">
                    <AnimatePresence mode="wait" initial={false}>
                        {deleteState === 'idle' ? (
                            <motion.button
                                key="trash"
                                type="button"
                                onClick={() => setDeleteState('confirming')}
                                aria-label="Delete note"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                transition={{ duration: 0.12 }}
                                className="grid h-7 w-7 place-items-center rounded-lg text-fog-600 opacity-0 transition-[opacity,color,background-color] duration-150 group-hover:opacity-100 hover:bg-ember-500/[0.12] hover:text-ember-400 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400/60"
                            >
                                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </motion.button>
                        ) : (
                            <DeleteConfirm
                                key="confirm"
                                onConfirm={handleDeleteConfirm}
                                onCancel={() => setDeleteState('idle')}
                                loading={deleteState === 'deleting'}
                            />
                        )}
                    </AnimatePresence>
                </div>
            )}

            {/* ── Header ────────────────────────────────────────────────── */}
            <header className="relative flex items-center gap-3">
                {/* Avatar / sender chip */}
                <button
                    type="button"
                    onClick={clickableSender ? () => onSelectContact(note.senderId) : undefined}
                    disabled={!clickableSender}
                    aria-label={clickableSender ? `Filter by ${note.sender}` : undefined}
                    title={clickableSender ? `Show all notes from ${note.sender}` : undefined}
                    className={cx(
                        'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-700 font-mono text-[12px] text-signal-300 shadow-hairline',
                        clickableSender
                            ? 'cursor-pointer transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-px hover:bg-ink-600 hover:shadow-signal-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60 active:scale-95'
                            : 'cursor-default'
                    )}
                >
                    {initials(note.sender)}
                </button>

                <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-[14px] font-bold text-fog-50">
                        {clickableSender ? (
                            <button
                                type="button"
                                onClick={() => onSelectContact(note.senderId)}
                                aria-label={`Filter by ${note.sender}`}
                                className="group/sender inline-flex items-baseline gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                            >
                                <span className="underline decoration-fog-600/0 underline-offset-2 transition-[text-decoration-color,color] duration-150 group-hover/sender:text-verdigris-100 group-hover/sender:decoration-verdigris-400/60">
                                    <Highlight text={note.sender} query={term} />
                                </span>
                            </button>
                        ) : (
                            <Highlight text={note.sender} query={term} />
                        )}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-fog-500">
                        {formatRelative(note.createdAt)}
                        {note.folderName && <span className="text-fog-600"> · {note.folderName}</span>}
                    </p>
                </div>
                {note.durationSec != null && (
                    <span className="rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[11px] tabular-nums text-fog-300 shadow-hairline">
                        {formatDuration(note.durationSec)}
                    </span>
                )}
            </header>

            {/* ── Body ──────────────────────────────────────────────────── */}
            <div className="relative mt-4 flex-1">
                {note.title && (
                    <p className="mb-1 text-[15px] font-bold tracking-[-0.01em] text-fog-50">
                        <Highlight text={note.title} query={term} />
                    </p>
                )}

                {/*
                  * dir="auto" lets the browser's bidi algorithm decide alignment.
                  * Arabic paragraphs align right; English paragraphs align left.
                  * No manual RTL detection needed.
                  */}
                <p
                    dir="auto"
                    className={cx('text-[14px] leading-relaxed text-fog-200', !open && 'line-clamp-3')}
                >
                    {note.summary ? (
                        <Highlight text={note.summary} query={term} />
                    ) : (
                        <em className="not-italic text-fog-500">Summary pending…</em>
                    )}
                </p>

                <AnimatePresence initial={false}>
                    {expanded && note.transcript && (
                        <motion.div key="transcript" {...collapse} className="overflow-hidden">
                            <div className="mt-4 border-t border-white/[0.06] pt-3">
                                <p className="eyebrow mb-1.5">Transcript</p>
                                <p
                                    dir="auto"
                                    className="text-[13px] leading-relaxed text-fog-400"
                                >
                                    <Highlight text={note.transcript} query={term} />
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── Footer: waveform + player ─────────────────────────────── */}
            <footer className="relative mt-4 flex items-center gap-3">
                {/*
                  * Waveform — takes all remaining space. The progress sweep
                  * and pulsing bars live inside this container.
                  *
                  * The Play/Pause button is a SIBLING flex item (not absolute)
                  * so it occupies its own physical width and cannot overlap
                  * the rightmost waveform bars.
                  */}
                <div className="relative flex h-7 flex-1 items-center gap-[3px]" aria-hidden="true">
                    {/* Progress sweep */}
                    {isPlaying && (
                        <motion.span
                            className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-signal-400/[0.07]"
                            animate={{ width: `${Math.round(progress * 100)}%` }}
                            transition={{ duration: 0.15, ease: 'linear' }}
                        />
                    )}

                    {bars.map((h, i) => (
                        <motion.span
                            key={i}
                            className={cx(
                                'w-[3px] rounded-full transition-colors duration-300',
                                isPlaying ? 'bg-signal-400' : 'bg-signal-400/40 group-hover:bg-signal-400/75'
                            )}
                            style={{ height: `${Math.round(h * 100)}%` }}
                            animate={
                                isPlaying && !reduce
                                    ? {
                                          scaleY: [1, 0.4 + h * 0.8, 1, 0.6 + h * 0.5, 1],
                                          opacity: [0.6, 1, 0.7, 1, 0.6],
                                      }
                                    : { scaleY: 1, opacity: isPlaying ? 0.9 : undefined }
                            }
                            transition={
                                isPlaying && !reduce
                                    ? {
                                          duration: 0.55 + h * 0.3,
                                          repeat: Infinity,
                                          repeatType: 'mirror',
                                          ease: 'easeInOut',
                                          delay: i * 0.022,
                                      }
                                    : { duration: 0.2 }
                            }
                        />
                    ))}
                </div>

                {/* Play / Pause — sibling flex item, NOT absolute, so it sits
                    cleanly beside the waveform and doesn't clip the bars. */}
                {note.hasAudio && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleAudio();
                        }}
                        aria-label={
                            isLoading ? 'Loading audio…'
                            : isPlaying ? 'Pause voice note'
                            : 'Play voice note'
                        }
                        disabled={isLoading}
                        className={cx(
                            'grid h-7 w-7 shrink-0 place-items-center rounded-full',
                            'shadow-hairline outline-none transition-[transform,background-color,box-shadow] duration-150 ease-snap',
                            'focus-visible:ring-2 focus-visible:ring-signal-400/60',
                            isLoading && 'cursor-wait',
                            !isLoading && isPlaying
                                ? 'scale-105 bg-signal-400 text-ink-950 shadow-signal-sm'
                                : 'bg-white/[0.07] text-fog-300 hover:scale-105 hover:bg-signal-400/[0.15] hover:text-signal-300 group-hover:bg-white/[0.10]'
                        )}
                    >
                        <AnimatePresence mode="wait" initial={false}>
                            {isLoading ? (
                                <motion.span
                                    key="loading"
                                    initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={reduce ? undefined : { scale: 0.6, opacity: 0 }}
                                    transition={{ duration: 0.1 }}
                                    className="grid place-items-center"
                                >
                                    {/* Inline spinner matching the card's glassmorphism */}
                                    <span className="h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-fog-600/40 border-t-signal-400" />
                                </motion.span>
                            ) : isPlaying ? (
                                <motion.span
                                    key="pause"
                                    initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={reduce ? undefined : { scale: 0.6, opacity: 0 }}
                                    transition={{ duration: 0.1 }}
                                    className="grid place-items-center"
                                >
                                    <Pause aria-hidden="true" className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
                                </motion.span>
                            ) : (
                                <motion.span
                                    key="play"
                                    initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={reduce ? undefined : { scale: 0.6, opacity: 0 }}
                                    transition={{ duration: 0.1 }}
                                    className="grid place-items-center"
                                >
                                    <Play aria-hidden="true" className="h-3.5 w-3.5 translate-x-[1px] fill-current" strokeWidth={0} />
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </button>
                )}

                {note.tags.slice(0, 2).map((t) => (
                    <span key={t} className="rounded-md bg-verdigris-400/10 px-2 py-0.5 font-mono text-[10.5px] text-verdigris-300">
                        {t}
                    </span>
                ))}
                {hasMore && (
                    <button
                        type="button"
                        onClick={onToggle}
                        aria-expanded={expanded}
                        aria-label={expanded ? 'Show less' : 'Show more'}
                        className="grid h-7 w-7 place-items-center rounded-lg text-fog-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-fog-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                    >
                        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={SPRING_SNAPPY} className="grid place-items-center">
                            <ChevronDown aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                        </motion.span>
                    </button>
                )}
            </footer>
        </motion.article>
    );
}
