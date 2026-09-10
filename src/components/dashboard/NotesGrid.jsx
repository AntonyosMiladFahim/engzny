import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Mic, RefreshCw } from 'lucide-react';
import NoteCard from './NoteCard';
import Button from '../ui/Button';
import { EASE_SNAP, stagger } from '../motion';

function SkeletonCard({ i }) {
    return (
        <div className="glass-sm relative overflow-hidden rounded-3xl p-5" aria-hidden="true">
            <div className="flex items-center gap-3">
                <span className="h-9 w-9 rounded-xl bg-white/[0.06]" />
                <div className="flex-1">
                    <span className="block h-3 w-1/2 rounded bg-white/[0.07]" />
                    <span className="mt-2 block h-2.5 w-1/3 rounded bg-white/[0.05]" />
                </div>
            </div>
            <div className="mt-5 space-y-2">
                <span className="block h-3 rounded bg-white/[0.06]" style={{ width: `${88 - (i % 3) * 6}%` }} />
                <span className="block h-3 rounded bg-white/[0.06]" style={{ width: `${96 - (i % 2) * 10}%` }} />
                <span className="block h-3 rounded bg-white/[0.06]" style={{ width: `${60 + (i % 4) * 7}%` }} />
            </div>
            <div className="mt-5 h-5 rounded bg-white/[0.04]" />
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
        </div>
    );
}

function EmptyState({ query, linked, contactName }) {
    const title = query ? 'Nothing matches that' : contactName ? 'Nothing from them yet' : 'Quiet in here';
    const body = query ? (
        contactName ? (
            <>
                No summary from <span className="text-fog-200">{contactName}</span> mentions that. Clear the contact to
                search everyone.
            </>
        ) : (
            'Try a sender’s name or a word from the summary.'
        )
    ) : contactName ? (
        <>
            <span className="text-fog-200">{contactName}</span> hasn’t sent a voice note since you linked WhatsApp.
        </>
    ) : linked ? (
        'Forward a voice note to your linked number and the summary will appear here.'
    ) : (
        'Link your WhatsApp to start receiving summaries.'
    );

    return (
        <div className="glass-sm mx-auto flex max-w-[460px] flex-col items-center rounded-4xl px-8 py-12 text-center">
            <div className="flex h-10 items-end gap-[4px]" aria-hidden="true">
                {[0.3, 0.6, 1, 0.75, 0.45, 0.9, 0.55, 0.35].map((h, i) => (
                    <motion.span
                        key={i}
                        className="w-[4px] rounded-full bg-signal-400/70"
                        animate={{ height: [`${h * 100}%`, `${Math.max(20, h * 60)}%`, `${h * 100}%`] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: i * 0.08 }}
                    />
                ))}
            </div>
            <h3 className="mt-6 text-[18px] font-bold tracking-[-0.02em] text-fog-50">{title}</h3>
            <p className="mt-2 max-w-[32ch] text-[14px] leading-relaxed text-fog-400">{body}</p>
            {!query && !contactName && !linked && (
                <Link
                    to="/connect"
                    className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl2 bg-signal-400 px-4 text-[14px] font-bold text-ink-950 shadow-signal-sm transition-shadow duration-150 hover:shadow-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
                >
                    <Mic aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                    Connect WhatsApp
                </Link>
            )}
        </div>
    );
}

function ErrorState({ error, onRetry }) {
    return (
        <div role="alert" className="mx-auto flex max-w-[460px] flex-col items-center rounded-4xl border border-ember-400/20 bg-ember-500/[0.07] px-8 py-10 text-center shadow-hairline">
            <p className="text-[16px] font-bold text-ember-200">Couldn’t load your notes</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-fog-300">{error?.message || 'The server did not respond.'}</p>
            <Button variant="ghost" icon={RefreshCw} onClick={onRetry} className="mt-5 h-10 w-auto px-4 text-[14px]">
                Try again
            </Button>
        </div>
    );
}

/**
 * Auto-fill grid: never fewer than 1 column, never a card narrower than 280px.
 *
 * `pending` is true while the deep-search request for the *current* query is
 * still in flight. Rather than tearing the list down and replaying a skeleton
 * (which would make every keystroke feel like a page load), the whole grid
 * dips in opacity and picks up a 2px blur — the results underneath stay
 * readable, stay interactive, and simply re-focus when the answer lands.
 * Nothing unmounts, so cards that survive the new query never re-enter.
 */
export default function NotesGrid({
    notes,
    loading,
    error,
    onRetry,
    query,
    linked,
    groupKey,
    pending = false,
    contactName = null,
    onSelectContact,
}) {
    const reduce = useReducedMotion();
    const [expandedId, setExpandedId] = useState(null);

    let body;
    if (error && notes.length === 0) {
        body = <ErrorState error={error} onRetry={onRetry} />;
    } else if (loading && notes.length === 0) {
        body = (
            <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))]" aria-busy="true" aria-label="Loading notes">
                {Array.from({ length: 6 }).map((_, i) => (
                    <SkeletonCard key={i} i={i} />
                ))}
            </div>
        );
    } else if (notes.length === 0) {
        body = <EmptyState query={query} linked={linked} contactName={contactName} />;
    } else {
        body = (
            <motion.div
                key={groupKey}
                initial={reduce ? false : 'hidden'}
                animate="show"
                variants={reduce ? undefined : stagger(0.02, 0.035)}
                className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))]"
            >
                {notes.map((n) => (
                    <NoteCard
                        key={n.id}
                        note={n}
                        query={query}
                        expanded={expandedId === n.id}
                        onToggle={() => setExpandedId((cur) => (cur === n.id ? null : n.id))}
                        onSelectContact={onSelectContact}
                    />
                ))}
            </motion.div>
        );
    }

    if (reduce) return body;

    return (
        <motion.div
            animate={{ opacity: pending ? 0.45 : 1, filter: pending ? 'blur(2px)' : 'blur(0px)' }}
            transition={{ duration: pending ? 0.16 : 0.28, ease: EASE_SNAP }}
        >
            {body}
        </motion.div>
    );
}
