import React, { useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import useTilt from '../../hooks/useTilt';
import cx from '../ui/cx';
import { collapse, riseSoft, SPRING_SNAPPY } from '../motion';
import { formatDuration, formatRelative, initials, waveformFor } from '../format';

/**
 * A voice-note summary card. Weight is communicated through motion: a
 * pointer-driven 3.5° tilt with a following sheen (desktop only), a 3px lift
 * on hover and a 0.8% compress on press.
 */
export default function NoteCard({ note, expanded = false, onToggle }) {
    const reduce = useReducedMotion();
    const tilt = useTilt();
    const bars = useMemo(() => waveformFor(note.id, 22), [note.id]);
    const hasMore = Boolean(note.transcript) || (note.summary?.length ?? 0) > 180;

    return (
        <motion.article
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

            <header className="relative flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-700 font-mono text-[12px] text-signal-300 shadow-hairline">
                    {initials(note.sender)}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-[14px] font-bold text-fog-50">{note.sender}</p>
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

            <div className="relative mt-4 flex-1">
                {note.title && <p className="mb-1 text-[15px] font-bold tracking-[-0.01em] text-fog-50">{note.title}</p>}
                <p className={cx('text-[14px] leading-relaxed text-fog-200', !expanded && 'line-clamp-3')}>
                    {note.summary || <em className="not-italic text-fog-500">Summary pending…</em>}
                </p>

                <AnimatePresence initial={false}>
                    {expanded && note.transcript && (
                        <motion.div key="transcript" {...collapse} className="overflow-hidden">
                            <div className="mt-4 border-t border-white/[0.06] pt-3">
                                <p className="eyebrow mb-1.5">Transcript</p>
                                <p className="text-[13px] leading-relaxed text-fog-400">{note.transcript}</p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <footer className="relative mt-4 flex items-center gap-3">
                <div className="flex h-5 flex-1 items-center gap-[3px]" aria-hidden="true">
                    {bars.map((h, i) => (
                        <span
                            key={i}
                            className="w-[3px] rounded-full bg-signal-400/40 transition-colors duration-300 group-hover:bg-signal-400/75"
                            style={{ height: `${Math.round(h * 100)}%` }}
                        />
                    ))}
                </div>
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
