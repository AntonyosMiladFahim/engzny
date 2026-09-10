import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Search, Users } from 'lucide-react';
import cx from '../ui/cx';
import { initials } from '../format';
import { SPRING_SNAPPY } from '../motion';

/** Above this many contacts the rail gets its own inline filter. */
const FILTER_THRESHOLD = 6;

/**
 * One contact row.
 *
 * Tactility is layered rather than loud: the plate fades in on hover, the row
 * nudges 2px right, the avatar warms from fog to signal, a chevron slides out
 * of the right edge, and a press compresses the whole row by 1.5%. All of it
 * is CSS transition work on a single element — no re-render, no jank — while
 * the active plate itself is a framer-motion shared layer so it *slides*
 * between rows instead of blinking.
 */
function ContactRow({ contact, active, onSelect, layoutGroup }) {
    return (
        <li>
            <button
                type="button"
                onClick={() => onSelect?.(contact.id)}
                aria-current={active ? 'true' : undefined}
                title={contact.handle ? `${contact.name} · ${contact.handle}` : contact.name}
                className={cx(
                    'group/row relative flex w-full items-center gap-2.5 rounded-xl py-1.5 pl-2 pr-2.5 text-left outline-none',
                    'transition-[transform,color] duration-150 ease-snap active:scale-[0.985]',
                    active ? 'text-fog-50' : 'text-fog-300 hover:translate-x-[2px] hover:text-fog-100',
                    'focus-visible:ring-2 focus-visible:ring-signal-400/60'
                )}
            >
                {active && (
                    <motion.span
                        layoutId={`${layoutGroup}-contact-plate`}
                        transition={SPRING_SNAPPY}
                        aria-hidden="true"
                        className="absolute inset-0 rounded-xl bg-white/[0.06] shadow-hairline"
                    />
                )}
                {active && (
                    <motion.span
                        layoutId={`${layoutGroup}-contact-bar`}
                        transition={SPRING_SNAPPY}
                        aria-hidden="true"
                        className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-full bg-verdigris-400"
                    />
                )}

                {/* Hover plate, kept separate from the active layer so the two
                    can overlap without the shared-layout animation flickering. */}
                <span
                    aria-hidden="true"
                    className={cx(
                        'pointer-events-none absolute inset-0 rounded-xl bg-white/[0.035] opacity-0 transition-opacity duration-150',
                        !active && 'group-hover/row:opacity-100'
                    )}
                />

                <span
                    className={cx(
                        'relative grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink-700 font-mono text-[10.5px] leading-none shadow-hairline transition-colors duration-250',
                        active
                            ? 'text-verdigris-300 ring-1 ring-verdigris-400/30'
                            : 'text-fog-400 group-hover/row:text-verdigris-300'
                    )}
                >
                    {initials(contact.name)}
                </span>

                <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] leading-tight">{contact.name}</span>
                    {contact.handle && (
                        <span className="mt-[3px] block truncate font-mono text-[10.5px] leading-none text-fog-500">
                            {contact.handle}
                        </span>
                    )}
                </span>

                {contact.count != null && (
                    <span
                        className={cx(
                            'relative font-mono text-[11px] tabular-nums transition-opacity duration-150',
                            active ? 'text-fog-300' : 'text-fog-500',
                            'group-hover/row:opacity-0'
                        )}
                    >
                        {contact.count}
                    </span>
                )}
                <ChevronRight
                    aria-hidden="true"
                    strokeWidth={2}
                    className={cx(
                        'pointer-events-none absolute right-2 h-3.5 w-3.5 translate-x-1 text-fog-400 opacity-0 transition-[transform,opacity] duration-150 ease-snap',
                        'group-hover/row:translate-x-0 group-hover/row:opacity-100'
                    )}
                />
            </button>
        </li>
    );
}

/**
 * The "Contacts" rail: every WhatsApp sender who has ever landed a summary
 * here, newest conversation first. Selecting one filters the NotesGrid.
 *
 * `layoutGroup` must differ per mounted instance (sidebar vs drawer) or the
 * two active plates fight over the same shared layout id.
 */
export default function ContactList({
    contacts = [],
    activeId = null,
    onSelect,
    loading = false,
    error = null,
    layoutGroup = 'contacts',
}) {
    const [filter, setFilter] = useState('');

    const visible = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return contacts;
        return contacts.filter(
            (c) => c.name.toLowerCase().includes(q) || (c.handle ?? '').toLowerCase().includes(q)
        );
    }, [contacts, filter]);

    const showFilter = contacts.length > FILTER_THRESHOLD;

    return (
        <nav aria-label="Contacts" className="mt-7">
            <div className="mb-2 flex items-baseline justify-between gap-2 px-3">
                <h3 className="eyebrow">Contacts</h3>
                {contacts.length > 0 && (
                    <span className="font-mono text-[10.5px] tabular-nums text-fog-600">{contacts.length}</span>
                )}
            </div>

            {showFilter && (
                <label className="group/filter relative mb-2 flex h-8 items-center px-1">
                    <span className="sr-only">Filter contacts</span>
                    <Search
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-fog-600 transition-colors duration-150 group-focus-within/filter:text-verdigris-400"
                    />
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter contacts"
                        autoComplete="off"
                        spellCheck="false"
                        className="h-full w-full rounded-lg bg-white/[0.03] pl-8 pr-2 text-[12.5px] text-fog-100 shadow-hairline outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-fog-600 focus:bg-white/[0.05] focus:shadow-focus"
                    />
                </label>
            )}

            {loading && contacts.length === 0 ? (
                <ul className="flex flex-col gap-1.5 px-2" aria-hidden="true">
                    {[0.62, 0.48, 0.55].map((w, i) => (
                        <li key={i} className="flex h-10 items-center gap-2.5">
                            <span className="h-7 w-7 shrink-0 rounded-lg bg-white/[0.06]" />
                            <span className="h-3 rounded bg-white/[0.06]" style={{ width: `${w * 100}%` }} />
                        </li>
                    ))}
                </ul>
            ) : error ? (
                <p className="px-3 py-2 text-[12.5px] leading-relaxed text-fog-500">
                    Contacts unavailable right now.
                </p>
            ) : contacts.length === 0 ? (
                <div className="flex items-start gap-2.5 px-3 py-2">
                    <Users aria-hidden="true" strokeWidth={1.75} className="mt-[2px] h-3.5 w-3.5 shrink-0 text-fog-600" />
                    <p className="text-[12.5px] leading-relaxed text-fog-500">
                        Senders appear here as soon as the first voice note arrives.
                    </p>
                </div>
            ) : visible.length === 0 ? (
                <p className="px-3 py-2 text-[12.5px] leading-relaxed text-fog-500">
                    No contact matches “<span className="text-fog-300">{filter.trim()}</span>”.
                </p>
            ) : (
                <ul className="flex flex-col gap-0.5">
                    {visible.map((c) => (
                        <ContactRow
                            key={c.id}
                            contact={c}
                            active={activeId === c.id}
                            onSelect={onSelect}
                            layoutGroup={layoutGroup}
                        />
                    ))}
                </ul>
            )}
        </nav>
    );
}
