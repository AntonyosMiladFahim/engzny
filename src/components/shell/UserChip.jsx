import React from 'react';
import { initials } from '../format';
import cx from '../ui/cx';

export default function UserChip({ user, className, subtle = false }) {
    const name = user?.name || user?.email || 'You';
    return (
        <div className={cx('flex min-w-0 items-center gap-3', className)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-700 font-mono text-[12px] font-medium text-signal-300 shadow-hairline">
                {initials(name)}
            </span>
            {!subtle && (
                <div className="min-w-0 leading-tight">
                    <p className="truncate text-[14px] font-bold text-fog-50">{user?.name || 'Signed in'}</p>
                    {user?.email && <p className="truncate font-mono text-[11px] text-fog-500">{user.email}</p>}
                </div>
            )}
        </div>
    );
}
