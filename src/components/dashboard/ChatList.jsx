/**
 * src/components/dashboard/ChatList.jsx
 * ------------------------------------------------------------------
 * WhatsApp-style primary contact list rendered in the main content
 * area when no chat is selected (senderId == null).
 *
 * Each row shows:
 *   - Avatar (44 px, initials badge, verdigris text)
 *   - Bold name + phone handle
 *   - Last note timestamp + truncated summary snippet
 *   - Note count badge
 *
 * Clicking a row calls onSelect(contact.id) which sets ?sender= in
 * the URL, transitioning the main area into the chat timeline.
 * ------------------------------------------------------------------
 */

import React, { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatRelative, initials } from '../format';
import { SPRING_SNAPPY } from '../motion';
import cx from '../ui/cx';

/* -------------------------------------------------------------------------- */
/*  Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

function SkeletonRow({ i }) {
    const widths = [0.72, 0.55, 0.65, 0.5, 0.6];
    const w = widths[i % widths.length];
    return (
        <li
            aria-hidden="true"
            className="flex h-[68px] items-center gap-3.5 rounded-2xl px-3"
        >
            <span className="h-11 w-11 shrink-0 rounded-full bg-white/[0.06]" />
            <span className="flex-1 space-y-2">
                <span className="block h-3 rounded bg-white/[0.07]" style={{ width: `${w * 100}%` }} />
                <span className="block h-2.5 rounded bg-white/[0.04]" style={{ width: `${w * 60}%` }} />
            </span>
            <span className="h-4 w-4 rounded-full bg-white/[0.04]" />
        </li>
    );
}

/* -------------------------------------------------------------------------- */
/*  Empty state                                                                */
/* -------------------------------------------------------------------------- */

function EmptyState({ linked }) {
    return (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-12 items-end gap-[5px]" aria-hidden="true">
                {[0.35, 0.65, 1, 0.8, 0.5, 0.9, 0.6, 0.4].map((h, i) => (
                    <motion.span
                        key={i}
                        className="w-[4px] rounded-full bg-signal-400/60"
                        animate={{ height: [`${h * 100}%`, `${Math.max(20, h * 55)}%`, `${h * 100}%`] }}
                        transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut', delay: i * 0.09 }}
                    />
                ))}
            </div>
            <div>
                <p className="text-[17px] font-bold tracking-[-0.02em] text-fog-100">
                    No chats yet
                </p>
                <p className="mt-1.5 max-w-[30ch] text-[13.5px] leading-relaxed text-fog-500">
                    {linked
                        ? 'Forward a voice note to your linked number and the sender will appear here.'
                        : 'Link your WhatsApp to start receiving summarised voice notes.'}
                </p>
            </div>
            {!linked && (
                <Link
                    to="/connect"
                    className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl2 bg-signal-400 px-4 text-[13.5px] font-bold text-ink-950 shadow-signal-sm transition-shadow duration-150 hover:shadow-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-300"
                >
                    <MessageSquare aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                    Link WhatsApp
                </Link>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Single chat row                                                            */
/* -------------------------------------------------------------------------- */

function ChatRow({ contact, onSelect }) {
    const reduce = useReducedMotion();

    return (
        <motion.li
            layout={reduce ? false : 'position'}
            initial={reduce ? false : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={SPRING_SNAPPY}
        >
            <button
                type="button"
                onClick={() => onSelect(contact.id)}
                className="group/row relative flex w-full items-center gap-3.5 rounded-2xl px-3 py-2.5 text-left outline-none transition-all duration-150 hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-signal-400/60 active:scale-[0.985]"
            >
                {/* Hover plate */}
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-2xl bg-white/[0.03] opacity-0 transition-opacity duration-150 group-hover/row:opacity-100"
                />

                {/* Avatar */}
                <span
                    aria-hidden="true"
                    className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink-700 font-mono text-[13px] font-bold text-verdigris-300 shadow-hairline transition-[background-color,color] duration-200 group-hover/row:bg-ink-600 group-hover/row:text-verdigris-200"
                >
                    {initials(contact.name)}
                    {/* Online dot — shown when contact has a very recent note */}
                    {contact.lastNoteAt &&
                        Date.now() - new Date(contact.lastNoteAt).getTime() < 3600_000 && (
                            <span
                                aria-hidden="true"
                                className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full bg-signal-400 ring-2 ring-ink-900"
                            />
                        )}
                </span>

                {/* Text block */}
                <span className="relative min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                        <span className="block truncate text-[14.5px] font-semibold leading-snug text-fog-50 transition-colors duration-150 group-hover/row:text-white">
                            {contact.name}
                        </span>
                        {contact.lastNoteAt && (
                            <span className="shrink-0 font-mono text-[10.5px] text-fog-600 transition-colors duration-150 group-hover/row:text-fog-500">
                                {formatRelative(contact.lastNoteAt)}
                            </span>
                        )}
                    </span>
                    <span className="mt-[3px] block truncate text-[12.5px] leading-none text-fog-500">
                        {contact.handle ?? ''}
                    </span>
                </span>

                {/* Note count badge */}
                {contact.count != null && contact.count > 0 && (
                    <span
                        className={cx(
                            'relative shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold tabular-nums',
                            'bg-verdigris-400/[0.12] text-verdigris-300 ring-1 ring-verdigris-400/20',
                            'transition-opacity duration-150 group-hover/row:opacity-0'
                        )}
                    >
                        {contact.count}
                    </span>
                )}

                {/* Chevron — slides in on hover */}
                <ChevronRight
                    aria-hidden="true"
                    strokeWidth={2}
                    className="pointer-events-none absolute right-3 h-4 w-4 translate-x-1 text-fog-500 opacity-0 transition-[transform,opacity] duration-150 ease-snap group-hover/row:translate-x-0 group-hover/row:opacity-100"
                />
            </button>
        </motion.li>
    );
}

/* -------------------------------------------------------------------------- */
/*  ChatList                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} props
 * @param {object[]} props.contacts   From useContacts() (already normalised)
 * @param {Function} props.onSelect   Called with senderId when a row is clicked
 * @param {boolean}  props.loading
 * @param {boolean}  props.linked     True when WhatsApp is connected
 */
export default function ChatList({ contacts = [], onSelect, loading = false, linked = false }) {
    const reduce = useReducedMotion();

    // Sort: newest note first, then alphabetically.
    const sorted = useMemo(
        () =>
            [...contacts].sort(
                (a, b) =>
                    new Date(b.lastNoteAt ?? 0) - new Date(a.lastNoteAt ?? 0) ||
                    a.name.localeCompare(b.name)
            ),
        [contacts]
    );

    if (loading && contacts.length === 0) {
        return (
            <ul className="flex flex-col gap-1" aria-hidden="true" aria-busy="true">
                {Array.from({ length: 5 }).map((_, i) => (
                    <SkeletonRow key={i} i={i} />
                ))}
            </ul>
        );
    }

    if (contacts.length === 0) {
        return <EmptyState linked={linked} />;
    }

    return (
        <motion.ul
            className="flex flex-col gap-0.5"
            initial={reduce ? false : 'hidden'}
            animate="show"
            variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.035 } },
            }}
        >
            {sorted.map((contact) => (
                <ChatRow
                    key={contact.id}
                    contact={contact}
                    onSelect={onSelect}
                />
            ))}
        </motion.ul>
    );
}
