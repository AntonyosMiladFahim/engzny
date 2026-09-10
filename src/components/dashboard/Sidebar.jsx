import React from 'react';
import { LogOut } from 'lucide-react';
import Brand from '../auth/Brand';
import FolderList from './FolderList';
import ConnectionPill from './ConnectionPill';
import UserChip from '../shell/UserChip';
import cx from '../ui/cx';

export default function Sidebar({ folders, activeId, onSelect, loading, totalCount, connection, user, onLogout, className }) {
    return (
        <aside
            className={cx(
                'hairline-y sticky top-0 hidden h-dvh w-[272px] shrink-0 flex-col px-5 py-6 lg:flex',
                className
            )}
        >
            <div className="px-1">
                <Brand compact />
            </div>

            <div className="mt-8 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
                <FolderList
                    folders={folders}
                    activeId={activeId}
                    onSelect={onSelect}
                    loading={loading}
                    totalCount={totalCount}
                    layoutGroup="sidebar"
                />
            </div>

            <div className="mt-6 flex flex-col gap-4">
                <ConnectionPill status={connection?.status} isConnected={connection?.isConnected} className="w-fit" />
                <div className="glass-sm flex items-center gap-2 rounded-2xl p-2 pl-2.5">
                    <UserChip user={user} className="flex-1" />
                    <button
                        type="button"
                        onClick={onLogout}
                        aria-label="Log out"
                        title="Log out"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-fog-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-fog-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                    >
                        <LogOut aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                </div>
            </div>
        </aside>
    );
}
