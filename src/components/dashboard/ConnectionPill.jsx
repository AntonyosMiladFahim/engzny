import React from 'react';
import { Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import cx from '../ui/cx';

export default function ConnectionPill({ status, isConnected, className }) {
    const known = Boolean(status);
    const label = isConnected ? 'WhatsApp linked' : known ? 'Not linked' : 'Checking link';
    const dot = isConnected
        ? 'bg-signal-400 shadow-[0_0_8px_rgba(201,240,74,0.8)]'
        : known
        ? 'bg-ember-400'
        : 'bg-fog-500 animate-pulse-dot';

    const inner = (
        <>
            <span aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', dot)} />
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{label}</span>
            {!isConnected && known && <Link2 aria-hidden="true" className="h-3.5 w-3.5 text-fog-400" strokeWidth={2} />}
        </>
    );

    const base = 'inline-flex h-9 items-center gap-2 rounded-full px-3.5 shadow-hairline';

    if (isConnected || !known) {
        return <span className={cx(base, 'bg-white/[0.04] text-fog-300', className)}>{inner}</span>;
    }
    return (
        <Link
            to="/connect"
            className={cx(base, 'bg-ember-400/10 text-ember-200 transition-colors duration-150 hover:bg-ember-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-300/60', className)}
        >
            {inner}
        </Link>
    );
}
