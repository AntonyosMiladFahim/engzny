import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, Inbox, Link2, Search } from 'lucide-react';
import cx from '../ui/cx';
import { SPRING_SNAPPY } from '../motion';

function Item({ icon: Icon, label, active, onClick, to, badge }) {
    const cls = cx(
        'relative flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[10.5px] font-mono uppercase tracking-[0.1em] outline-none transition-colors duration-150',
        active ? 'text-fog-50' : 'text-fog-400 hover:text-fog-200',
        'focus-visible:ring-2 focus-visible:ring-signal-400/60'
    );
    const inner = (
        <>
            {active && (
                <motion.span
                    layoutId="mobile-nav-active"
                    transition={SPRING_SNAPPY}
                    aria-hidden="true"
                    className="absolute inset-x-2 inset-y-1.5 rounded-xl bg-white/[0.06] shadow-hairline"
                />
            )}
            <span className="relative">
                <Icon aria-hidden="true" className={cx('h-5 w-5', active && 'text-signal-400')} strokeWidth={1.75} />
                {badge && <span aria-hidden="true" className={cx('absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-ink-950', badge)} />}
            </span>
            <span className="relative">{label}</span>
        </>
    );
    if (to) {
        return (
            <Link to={to} className={cls} aria-label={label}>
                {inner}
            </Link>
        );
    }
    return (
        <button type="button" onClick={onClick} className={cls} aria-pressed={active || undefined}>
            {inner}
        </button>
    );
}

/** Bottom navigation for < lg. Sits above the safe-area inset. */
export default function MobileNav({ view, onNotes, onFolders, onSearch, linked }) {
    return (
        <nav
            aria-label="Primary"
            className="fixed inset-x-3 bottom-3 z-30 lg:hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
            <div className="glass flex items-center gap-1 rounded-3xl p-1.5">
                <Item icon={Inbox} label="Notes" active={view === 'all'} onClick={onNotes} />
                <Item icon={BookOpen} label="Library" active={view === 'folder'} onClick={onFolders} />
                <Item icon={Search} label="Search" onClick={onSearch} />
                <Item icon={Link2} label="Link" to="/connect" badge={linked ? 'bg-signal-400' : 'bg-ember-400'} />
            </div>
        </nav>
    );
}
