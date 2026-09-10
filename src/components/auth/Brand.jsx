import React from 'react';
import { Link } from 'react-router-dom';
import cx from '../ui/cx';

/** Wordmark + custom waveform glyph. Not a lucide icon on purpose. */
export default function Brand({ compact = false, className }) {
    return (
        <Link
            to="/login"
            className={cx(
                'group inline-flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-signal-400/70 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-950',
                className
            )}
        >
            <span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl2 bg-ink-800 shadow-hairline">
                <span aria-hidden="true" className="absolute inset-x-2 top-0 h-px bg-white/25" />
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-signal-400" fill="currentColor" aria-hidden="true">
                    <rect x="2.5" y="9.5" width="2.6" height="5" rx="1.3" />
                    <rect x="7.2" y="5.5" width="2.6" height="13" rx="1.3" />
                    <rect x="11.9" y="2.5" width="2.6" height="19" rx="1.3" />
                    <rect x="16.6" y="7" width="2.6" height="10" rx="1.3" />
                    <rect x="21.3" y="10.5" width="2.6" height="3" rx="1.3" transform="translate(-2.6 0)" />
                </svg>
            </span>
            <span className="flex items-baseline gap-2">
                <span className="text-[18px] font-bold tracking-[-0.02em] text-fog-50">engzny</span>
                {!compact && (
                    <span className="hidden font-mono text-[11px] text-fog-500 xs:inline">/ voice → text</span>
                )}
            </span>
        </Link>
    );
}
