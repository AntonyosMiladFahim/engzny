import React from 'react';
import { motion } from 'framer-motion';
import { Folder, Inbox } from 'lucide-react';
import cx from '../ui/cx';
import { SPRING_SNAPPY } from '../motion';

function Row({ active, icon: Icon, label, count, onClick, layoutGroup }) {
    return (
        <li>
            <button
                type="button"
                onClick={onClick}
                aria-current={active ? 'page' : undefined}
                className={cx(
                    'group relative flex h-10 w-full items-center gap-3 rounded-xl pl-3 pr-2.5 text-left text-[14px] outline-none transition-colors duration-150',
                    active ? 'text-fog-50' : 'text-fog-300 hover:bg-white/[0.04] hover:text-fog-100',
                    'focus-visible:ring-2 focus-visible:ring-signal-400/60'
                )}
            >
                {active && (
                    <motion.span
                        layoutId={`${layoutGroup}-active`}
                        transition={SPRING_SNAPPY}
                        aria-hidden="true"
                        className="absolute inset-0 rounded-xl bg-white/[0.06] shadow-hairline"
                    />
                )}
                {active && (
                    <motion.span
                        layoutId={`${layoutGroup}-bar`}
                        transition={SPRING_SNAPPY}
                        aria-hidden="true"
                        className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-full bg-signal-400"
                    />
                )}
                <Icon
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className={cx('relative h-4 w-4 shrink-0 transition-colors duration-150', active ? 'text-signal-400' : 'text-fog-500 group-hover:text-fog-300')}
                />
                <span className="relative min-w-0 flex-1 truncate">{label}</span>
                {count != null && (
                    <span className={cx('relative font-mono text-[11px] tabular-nums', active ? 'text-fog-300' : 'text-fog-500')}>
                        {count}
                    </span>
                )}
            </button>
        </li>
    );
}

/**
 * "All notes" + folder rows with a shared-layout active indicator that slides
 * between rows. `layoutGroup` must differ per instance (sidebar vs drawer).
 */
export default function FolderList({ folders = [], activeId = null, onSelect, loading = false, totalCount, layoutGroup = 'folders' }) {
    return (
        <nav aria-label="Folders">
            <ul className="flex flex-col gap-0.5">
                <Row
                    layoutGroup={layoutGroup}
                    active={activeId == null}
                    icon={Inbox}
                    label="All notes"
                    count={totalCount ?? null}
                    onClick={() => onSelect?.(null)}
                />
            </ul>

            <p className="eyebrow mb-2 mt-6 px-3">Folders</p>

            {loading && folders.length === 0 ? (
                <ul className="flex flex-col gap-1.5 px-3" aria-hidden="true">
                    {[0.7, 0.5, 0.6].map((w, i) => (
                        <li key={i} className="flex h-10 items-center gap-3">
                            <span className="h-4 w-4 rounded bg-white/[0.06]" />
                            <span className="h-3 rounded bg-white/[0.06]" style={{ width: `${w * 100}%` }} />
                        </li>
                    ))}
                </ul>
            ) : folders.length === 0 ? (
                <p className="px-3 py-2 text-[13px] leading-relaxed text-fog-500">
                    No folders yet. Summaries land in <span className="text-fog-300">All notes</span> until you create one.
                </p>
            ) : (
                <ul className="flex flex-col gap-0.5">
                    {folders.map((f) => (
                        <Row
                            key={f.id}
                            layoutGroup={layoutGroup}
                            active={activeId === f.id}
                            icon={Folder}
                            label={f.name}
                            count={f.count}
                            onClick={() => onSelect?.(f.id)}
                        />
                    ))}
                </ul>
            )}
        </nav>
    );
}
