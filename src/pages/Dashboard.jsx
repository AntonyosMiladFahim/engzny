import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Download, LogOut, Search, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useContacts, useDebouncedValue, useFolders, useVoiceNotes } from '../hooks/useLibrary';
import useWahaPolling from '../hooks/useWahaPolling';
import AppShell from '../components/shell/AppShell';
import Brand from '../components/auth/Brand';
import Sidebar from '../components/dashboard/Sidebar';
import FolderList from '../components/dashboard/FolderList';
import ContactList from '../components/dashboard/ContactList';
import NotesGrid from '../components/dashboard/NotesGrid';
import MobileNav from '../components/dashboard/MobileNav';
import Drawer from '../components/dashboard/Drawer';
import ConnectionPill from '../components/dashboard/ConnectionPill';
import UserChip from '../components/shell/UserChip';
import { toast } from '../components/ui/toast';
import { matchesQuery, contactHandle } from '../components/format';
import { rise, riseSoft, stagger, SPRING_SNAPPY } from '../components/motion';
import api from '../services/api';

export default function Dashboard() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const reduce = useReducedMotion();
    const [params, setParams] = useSearchParams();
    const folderId = params.get('folder');
    const senderId = params.get('sender');

    const [query, setQuery] = useState('');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [installable, setInstallable] = useState(() => !!window.engzny?.installPrompt);
    const [uploading, setUploading] = useState(false);
    const searchRef = useRef(null);

    // ── PWA install prompt ────────────────────────────────────────────────────
    useEffect(() => {
        const onInstallable = () => setInstallable(true);
        const onInstalled = () => setInstallable(false);
        window.addEventListener('pwa:installable', onInstallable);
        window.addEventListener('pwa:installed', onInstalled);
        return () => {
            window.removeEventListener('pwa:installable', onInstallable);
            window.removeEventListener('pwa:installed', onInstalled);
        };
    }, []);

    // The box stays instant; the network only sees the pauses between words.
    const debounced = useDebouncedValue(query);

    const foldersQ = useFolders();
    const contactsQ = useContacts();
    const notesQ = useVoiceNotes({ folderId, senderId, search: debounced });
    const waha = useWahaPolling({ interval: 30000, stopOnConnected: false });

    // ── Share inbox drainer ──────────────────────────────────────────────────
    // Uploads every file from the PWA share inbox (Web Share Target / file
    // handlers) to /api/ai/upload, then refreshes the notes list.
    const drainInbox = useCallback(async () => {
        const inbox = window.engzny?.shareInbox;
        if (!inbox) return;
        let items;
        try { items = await inbox.list(); } catch { return; }
        const pending = items.filter((i) => i.status === 'pending');
        if (!pending.length) return;

        setUploading(true);
        let succeeded = 0;
        for (const item of pending) {
            try {
                const full = await inbox.take(item.id);
                if (!full?.blob) continue;
                // Convert Blob → base64
                const buffer = await full.blob.arrayBuffer();
                const base64 = btoa(
                    new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), '')
                );
                await api.post('/ai/upload', {
                    audioBase64: base64,
                    mimeType: full.type || 'audio/ogg',
                });
                await inbox.delete(item.id);
                succeeded++;
            } catch (err) {
                console.error('[dashboard] upload failed for item', item.id, err);
            }
        }
        setUploading(false);
        if (succeeded > 0) {
            notesQ.refresh();
            // A shared note can introduce a sender the rail has never seen.
            contactsQ.refresh();
            toast.success(
                succeeded === 1 ? 'Voice note summarised.' : `${succeeded} voice notes summarised.`,
                { key: 'share-done', title: 'Done' }
            );
        }
    }, [notesQ]); // eslint-disable-line react-hooks/exhaustive-deps

    // Drain on mount (in case app was reopened after a share) and on new shares.
    useEffect(() => { drainInbox(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const onShare = () => drainInbox();
        window.addEventListener('share:received', onShare);
        return () => window.removeEventListener('share:received', onShare);
    }, [drainInbox]);

    const selectFolder = useCallback(
        (id) => {
            // A folder and a contact are two answers to the same question, so
            // picking one drops the other rather than intersecting silently.
            setParams(id ? { folder: id } : {}, { replace: true });
            setDrawerOpen(false);
        },
        [setParams]
    );

    const selectContact = useCallback(
        (id) => {
            // A rail row is a toggle, not a one-way door: clicking the lit
            // contact again returns you to everyone.
            setParams(id && id !== senderId ? { sender: id } : {}, { replace: true });
            setDrawerOpen(false);
        },
        [setParams, senderId]
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
    // Deep links land here before /notes/contacts has answered, so the scope
    // still has to be nameable from the URL alone.
    const activeContact = useMemo(() => {
        if (!senderId) return null;
        return (
            contactsQ.contacts.find((c) => c.id === senderId) ?? {
                id: senderId,
                name: contactHandle(senderId) || 'Unknown Contact',
                handle: null,
            }
        );
    }, [contactsQ.contacts, senderId]);

    // True while what is on screen does not yet answer what is in the box —
    // either the debounce is still counting or the request is in the air.
    const searching = query.trim() !== debounced.trim() || (Boolean(debounced.trim()) && notesQ.loading);

    /**
     * The server does the deep search across every summary; this pass only
     * refines what came back, using the same OR-over-terms rule Mongo's `$text`
     * applies. It keeps the grid honest during the debounce window (results
     * from the *previous* query are still mounted) without ever contradicting
     * the ranking the backend just handed us.
     */
    const filtered = useMemo(() => {
        const q = query.trim();
        if (!q) return notesQ.notes;
        return notesQ.notes.filter((n) => matchesQuery(n, q));
    }, [notesQ.notes, query]);

    const totalCount = useMemo(() => {
        const sum = foldersQ.folders.reduce((acc, f) => (f.count != null ? acc + f.count : acc), 0);
        if (folderId == null && senderId == null && !notesQ.loading) return notesQ.notes.length;
        return foldersQ.folders.length && foldersQ.folders.every((f) => f.count != null) ? sum : null;
    }, [foldersQ.folders, folderId, senderId, notesQ.loading, notesQ.notes.length]);

    const scopeLabel = activeContact ? activeContact.name : activeFolder ? activeFolder.name : 'All notes';

    const reveal = location.state?.from === 'connect';
    const variants = reduce ? undefined : stagger(reveal ? 0.25 : 0.04, 0.05);

    const focusSearch = useCallback(() => {
        searchRef.current?.focus();
        searchRef.current?.select?.();
        searchRef.current?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }, [reduce]);

    // ⌘K / Ctrl-K from anywhere, "/" only when you are not already typing —
    // the shortcut a desktop app would have, without stealing a slash from a
    // half-written search term.
    useEffect(() => {
        const onKey = (e) => {
            const el = document.activeElement;
            const typing = Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
            const combo = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
            const slash = e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
            if (!combo && !slash) return;
            e.preventDefault();
            focusSearch();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [focusSearch]);

    return (
        <AppShell reveal={reveal}>
            <div className="mx-auto flex w-full max-w-[1600px] flex-1">
                <Sidebar
                    folders={foldersQ.folders}
                    activeId={folderId}
                    onSelect={selectFolder}
                    loading={foldersQ.loading}
                    totalCount={totalCount}
                    contacts={contactsQ.contacts}
                    activeContactId={senderId}
                    onSelectContact={selectContact}
                    contactsLoading={contactsQ.loading}
                    contactsError={contactsQ.error}
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
                                    Library · {scopeLabel}
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

                                {/* The sidebar is off-screen below lg, so the
                                    active contact needs a way home from here. */}
                                {activeContact && (
                                    <motion.button
                                        type="button"
                                        layout={reduce ? false : 'position'}
                                        initial={reduce ? false : { opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={SPRING_SNAPPY}
                                        onClick={() => selectContact(null)}
                                        aria-label={`Clear contact filter: ${activeContact.name}`}
                                        className="group mt-4 inline-flex h-8 items-center gap-2 rounded-xl bg-verdigris-400/[0.09] pl-3 pr-2 text-[13px] text-verdigris-100 shadow-hairline ring-1 ring-verdigris-400/20 transition-colors duration-150 hover:bg-verdigris-400/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-verdigris-300"
                                    >
                                        <span aria-hidden="true" className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-verdigris-300/80">From</span>
                                        <span aria-hidden="true" className="max-w-[22ch] truncate font-bold">{activeContact.name}</span>
                                        <X aria-hidden="true" className="h-3.5 w-3.5 text-verdigris-300/70 transition-colors duration-150 group-hover:text-verdigris-100" strokeWidth={2.25} />
                                    </motion.button>
                                )}
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
                                        placeholder={activeContact ? `Search ${activeContact.name}’s notes` : 'Search sender or summary'}
                                        autoComplete="off"
                                        spellCheck="false"
                                        className="h-full w-full rounded-xl2 bg-ink-900/70 pl-10 pr-9 text-[14px] text-fog-50 shadow-hairline outline-none ring-1 ring-white/[0.08] transition-[box-shadow,ring-color] duration-150 ease-snap placeholder:text-fog-500/80 focus:bg-ink-900 focus:shadow-focus focus:ring-signal-400/70 [&::-webkit-search-cancel-button]:hidden"
                                    />
                                    {query ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setQuery('');
                                                searchRef.current?.focus();
                                            }}
                                            aria-label="Clear search"
                                            className="absolute right-2 grid h-7 w-7 place-items-center rounded-md text-fog-400 hover:bg-white/[0.06] hover:text-fog-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                                        >
                                            <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.25} />
                                        </button>
                                    ) : (
                                        <kbd
                                            aria-hidden="true"
                                            className="pointer-events-none absolute right-2.5 hidden rounded-[5px] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] leading-none text-fog-500 shadow-hairline transition-opacity duration-150 group-focus-within:opacity-0 lg:block"
                                        >
                                            ⌘K
                                        </kbd>
                                    )}

                                    {/* Indeterminate hairline: the only thing that
                                        moves while the deep search is in the air. */}
                                    {searching && !reduce && (
                                        <span
                                            aria-hidden="true"
                                            className="pointer-events-none absolute inset-x-3 bottom-[5px] h-px overflow-hidden rounded-full bg-white/[0.07]"
                                        >
                                            <motion.span
                                                className="block h-full w-1/3 rounded-full bg-signal-400"
                                                animate={{ x: ['-110%', '320%'] }}
                                                transition={{ duration: 0.85, repeat: Infinity, ease: 'easeInOut' }}
                                            />
                                        </span>
                                    )}
                                </label>
                                {/* Outside the <label> on purpose: anything in
                                    there becomes part of the input's accessible
                                    name, and a live region has no business
                                    renaming the field it describes. */}
                                <span role="status" aria-live="polite" className="sr-only">
                                    {searching ? 'Searching summaries…' : query.trim() ? `${filtered.length} matching notes` : ''}
                                </span>
                                <ConnectionPill status={waha.status} isConnected={waha.isConnected} className="hidden lg:inline-flex" />
                            </motion.div>
                        </div>

                        <motion.div variants={riseSoft} aria-hidden="true" className="h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent" />

                        {/* PWA install banner */}
                        {installable && (
                            <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-center justify-between gap-4 rounded-2xl bg-signal-400/[0.08] px-4 py-3 ring-1 ring-signal-400/20"
                            >
                                <div className="flex items-center gap-3">
                                    <Download className="h-4 w-4 shrink-0 text-signal-400" strokeWidth={1.75} />
                                    <p className="text-[13.5px] text-fog-200">
                                        Install engzny on your home screen to share voice notes directly from WhatsApp.
                                    </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => window.engzny?.promptInstall()}
                                        className="rounded-lg bg-signal-400 px-3 py-1.5 text-[12px] font-bold text-ink-950 hover:bg-signal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                                    >
                                        Install
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setInstallable(false)}
                                        aria-label="Dismiss"
                                        className="grid h-7 w-7 place-items-center rounded-md text-fog-500 hover:bg-white/[0.06] hover:text-fog-200"
                                    >
                                        <X className="h-3.5 w-3.5" strokeWidth={2.25} />
                                    </button>
                                </div>
                            </motion.div>
                        )}

                        {/* Uploading indicator */}
                        {uploading && (
                            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal-400 animate-pulse">
                                Summarising shared audio…
                            </p>
                        )}
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
                                {activeFolder ? activeFolder.name : activeContact ? activeContact.name : query ? 'Results' : 'Recent'}
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
                            pending={searching}
                            contactName={activeContact?.name ?? null}
                            linked={waha.isConnected}
                            groupKey={`${folderId ?? 'all'}:${senderId ?? 'any'}:${debounced.trim()}`}
                            onSelectContact={selectContact}
                        />
                    </motion.section>
                </div>
            </div>

            <MobileNav
                view={folderId || senderId ? 'folder' : 'all'}
                onNotes={() => selectFolder(null)}
                onFolders={() => setDrawerOpen(true)}
                onSearch={focusSearch}
                linked={waha.isConnected}
            />

            <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Library">
                <FolderList
                    folders={foldersQ.folders}
                    activeId={folderId}
                    onSelect={selectFolder}
                    loading={foldersQ.loading}
                    totalCount={totalCount}
                    suspended={Boolean(senderId)}
                    layoutGroup="drawer"
                />

                <div aria-hidden="true" className="mx-3 mt-7 h-px bg-gradient-to-r from-white/[0.09] via-white/[0.04] to-transparent" />

                <ContactList
                    contacts={contactsQ.contacts}
                    activeId={senderId}
                    onSelect={selectContact}
                    loading={contactsQ.loading}
                    error={contactsQ.error}
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
