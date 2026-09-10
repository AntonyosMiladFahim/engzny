import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { LogOut, Search, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFolders, useVoiceNotes } from '../hooks/useLibrary';
import useWahaPolling from '../hooks/useWahaPolling';
import AppShell from '../components/shell/AppShell';
import Brand from '../components/auth/Brand';
import Sidebar from '../components/dashboard/Sidebar';
import FolderList from '../components/dashboard/FolderList';
import NotesGrid from '../components/dashboard/NotesGrid';
import MobileNav from '../components/dashboard/MobileNav';
import Drawer from '../components/dashboard/Drawer';
import ConnectionPill from '../components/dashboard/ConnectionPill';
import UserChip from '../components/shell/UserChip';
import { toast } from '../components/ui/toast';
import { rise, riseSoft, stagger } from '../components/motion';

export default function Dashboard() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const reduce = useReducedMotion();
    const [params, setParams] = useSearchParams();
    const folderId = params.get('folder');

    const [query, setQuery] = useState('');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const searchRef = useRef(null);

    const foldersQ = useFolders();
    const notesQ = useVoiceNotes({ folderId });
    const waha = useWahaPolling({ interval: 30000, stopOnConnected: false });

    const selectFolder = useCallback(
        (id) => {
            setParams(id ? { folder: id } : {}, { replace: true });
            setDrawerOpen(false);
        },
        [setParams]
    );

    useEffect(() => {
        if (foldersQ.error) {
            toast.error(foldersQ.error.message || 'The server did not respond.', {
                key: 'folders',
                title: 'Couldn’t load folders',
                action: { label: 'Retry', onClick: foldersQ.refresh },
            });
        }
    }, [foldersQ.error, foldersQ.refresh]);

    const activeFolder = useMemo(() => foldersQ.folders.find((f) => f.id === folderId) ?? null, [foldersQ.folders, folderId]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return notesQ.notes;
        return notesQ.notes.filter(
            (n) =>
                n.sender?.toLowerCase().includes(q) ||
                n.summary?.toLowerCase().includes(q) ||
                n.title?.toLowerCase().includes(q) ||
                n.tags?.some((t) => t.toLowerCase().includes(q))
        );
    }, [notesQ.notes, query]);

    const totalCount = useMemo(() => {
        const sum = foldersQ.folders.reduce((acc, f) => (f.count != null ? acc + f.count : acc), 0);
        if (folderId == null && !notesQ.loading) return notesQ.notes.length;
        return foldersQ.folders.length && foldersQ.folders.every((f) => f.count != null) ? sum : null;
    }, [foldersQ.folders, folderId, notesQ.loading, notesQ.notes.length]);

    const reveal = location.state?.from === 'connect';
    const variants = reduce ? undefined : stagger(reveal ? 0.25 : 0.04, 0.05);

    const focusSearch = () => {
        searchRef.current?.focus();
        searchRef.current?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    };

    return (
        <AppShell reveal={reveal}>
            <div className="mx-auto flex w-full max-w-[1600px] flex-1">
                <Sidebar
                    folders={foldersQ.folders}
                    activeId={folderId}
                    onSelect={selectFolder}
                    loading={foldersQ.loading}
                    totalCount={totalCount}
                    connection={waha}
                    user={user}
                    onLogout={logout}
                />

                <div className="flex min-w-0 flex-1 flex-col px-4 pb-28 pt-5 sm:px-8 lg:px-12 lg:pb-16 lg:pt-10">
                    {/* Mobile top row */}
                    <div className="mb-6 flex items-center justify-between lg:hidden">
                        <Brand compact />
                        <div className="flex items-center gap-2">
                            <ConnectionPill status={waha.status} isConnected={waha.isConnected} />
                            <UserChip user={user} subtle />
                        </div>
                    </div>

                    <motion.header initial={reduce ? false : 'hidden'} animate="show" variants={variants} className="flex flex-col gap-6">
                        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
                            <div>
                                <motion.p variants={rise} className="eyebrow mb-3">
                                    Library · {activeFolder ? activeFolder.name : 'All notes'}
                                </motion.p>
                                <motion.h1 variants={rise} className="text-display-sm text-fog-50">
                                    Dashboard
                                </motion.h1>
                                <motion.p variants={riseSoft} className="mt-3 text-[15px] text-fog-400">
                                    Welcome{user?.name ? `, ${user.name}` : ''}.{' '}
                                    <span className="text-fog-500">
                                        {notesQ.loading
                                            ? 'Fetching your notes…'
                                            : `${filtered.length} ${filtered.length === 1 ? 'note' : 'notes'}${
                                                  foldersQ.folders.length ? ` · ${foldersQ.folders.length} ${foldersQ.folders.length === 1 ? 'folder' : 'folders'}` : ''
                                              }`}
                                    </span>
                                </motion.p>
                            </div>

                            <motion.div variants={riseSoft} className="flex w-full items-center gap-3 sm:w-auto">
                                <label className="group relative flex h-11 w-full items-center sm:w-[300px]">
                                    <span className="sr-only">Search notes</span>
                                    <Search
                                        aria-hidden="true"
                                        className="pointer-events-none absolute left-3.5 h-4 w-4 text-fog-500 transition-colors duration-150 group-focus-within:text-signal-400"
                                        strokeWidth={1.75}
                                    />
                                    <input
                                        ref={searchRef}
                                        type="search"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Search sender or summary"
                                        autoComplete="off"
                                        className="h-full w-full rounded-xl2 bg-ink-900/70 pl-10 pr-9 text-[14px] text-fog-50 shadow-hairline outline-none ring-1 ring-white/[0.08] transition-[box-shadow,ring-color] duration-150 ease-snap placeholder:text-fog-500/80 focus:bg-ink-900 focus:shadow-focus focus:ring-signal-400/70 [&::-webkit-search-cancel-button]:hidden"
                                    />
                                    {query && (
                                        <button
                                            type="button"
                                            onClick={() => setQuery('')}
                                            aria-label="Clear search"
                                            className="absolute right-2 grid h-7 w-7 place-items-center rounded-md text-fog-400 hover:bg-white/[0.06] hover:text-fog-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                                        >
                                            <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.25} />
                                        </button>
                                    )}
                                </label>
                                <ConnectionPill status={waha.status} isConnected={waha.isConnected} className="hidden lg:inline-flex" />
                            </motion.div>
                        </div>

                        <motion.div variants={riseSoft} aria-hidden="true" className="h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
                    </motion.header>

                    <motion.section
                        initial={reduce ? false : { opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1], delay: reveal ? 0.45 : 0.15 }}
                        className="mt-8"
                        aria-labelledby="notes-heading"
                    >
                        <div className="mb-4 flex items-baseline justify-between">
                            <h2 id="notes-heading" className="text-[17px] font-bold tracking-[-0.015em] text-fog-50">
                                {activeFolder ? activeFolder.name : query ? 'Results' : 'Recent'}
                            </h2>
                            {notesQ.error && notesQ.notes.length > 0 && (
                                <button type="button" onClick={notesQ.refresh} className="font-mono text-[11px] uppercase tracking-[0.14em] text-ember-300 hover:text-ember-200">
                                    Offline · retry
                                </button>
                            )}
                        </div>

                        <NotesGrid
                            notes={filtered}
                            loading={notesQ.loading}
                            error={notesQ.error}
                            onRetry={notesQ.refresh}
                            query={query}
                            linked={waha.isConnected}
                            groupKey={`${folderId ?? 'all'}:${query}`}
                        />
                    </motion.section>
                </div>
            </div>

            <MobileNav
                view={folderId ? 'folder' : 'all'}
                onNotes={() => selectFolder(null)}
                onFolders={() => setDrawerOpen(true)}
                onSearch={focusSearch}
                linked={waha.isConnected}
            />

            <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Folders">
                <FolderList
                    folders={foldersQ.folders}
                    activeId={folderId}
                    onSelect={selectFolder}
                    loading={foldersQ.loading}
                    totalCount={totalCount}
                    layoutGroup="drawer"
                />
                <div className="mt-6 flex items-center gap-2 border-t border-white/[0.06] pt-5">
                    <UserChip user={user} className="flex-1" />
                    <button
                        type="button"
                        onClick={logout}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/[0.05] px-3.5 text-[13.5px] font-bold text-fog-100 shadow-hairline hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                    >
                        <LogOut aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                        Log out
                    </button>
                </div>
            </Drawer>
        </AppShell>
    );
}
