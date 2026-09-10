/**
 * src/pages/Dashboard.jsx
 * ------------------------------------------------------------------
 * The main application page after login. It has two visual states
 * controlled by the `?sender=` URL search param:
 *
 *   senderId == null  → ChatList (WhatsApp-style primary contact list)
 *   senderId != null  → Chat timeline: the NotesGrid scoped to one sender
 *
 * The desktop Sidebar already shows FolderList + ContactList; clicking a
 * contact there sets ?sender= and transitions the main area automatically.
 * The ChatList is the mobile-first primary surface for the same action.
 *
 * Share inbox: if window.engzny.shareInbox has pending items, a
 * ShareRoutingModal is rendered. It prompts the user to route each audio
 * file to a specific WhatsApp chat before uploading. On completion the
 * notes + contacts are refreshed.
 * ------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Download, LogOut, Search, Sparkles, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useContacts, useDebouncedValue, useFolders, useVoiceNotes } from '../hooks/useLibrary';
import useWahaPolling from '../hooks/useWahaPolling';
import AppShell from '../components/shell/AppShell';
import Brand from '../components/auth/Brand';
import Sidebar from '../components/dashboard/Sidebar';
import FolderList from '../components/dashboard/FolderList';
import ContactList from '../components/dashboard/ContactList';
import ChatList from '../components/dashboard/ChatList';
import NotesGrid from '../components/dashboard/NotesGrid';
import MobileNav from '../components/dashboard/MobileNav';
import Drawer from '../components/dashboard/Drawer';
import ConnectionPill from '../components/dashboard/ConnectionPill';
import ShareRoutingModal from '../components/dashboard/ShareRoutingModal';
import BulkAnalyzeModal from '../components/dashboard/BulkAnalyzeModal';
import AnalyzedChatsView from '../components/dashboard/AnalyzedChatsView';
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
    const searchRef = useRef(null);

    // Partition view state ('library' vs 'analyzed') & Bulk Analyze Modal
    const [partition, setPartition] = useState('library');
    const [bulkModalOpen, setBulkModalOpen] = useState(false);

    // ── Pending share items ───────────────────────────────────────────────
    // When the share inbox has items we show ShareRoutingModal instead of
    // auto-uploading blindly. The modal clears this list when done.
    const [pendingShares, setPendingShares] = useState([]);

    const checkInbox = useCallback(async () => {
        const inbox = window.engzny?.shareInbox;
        if (!inbox) return;
        try {
            const items = await inbox.list();
            const pending = items.filter((i) => i.status === 'pending');
            if (pending.length > 0) {
                setPendingShares(pending);
            }
        } catch {
            /* inbox unavailable (no SW) — ignore */
        }
    }, []);

    // Check on mount and whenever a new share arrives.
    useEffect(() => { checkInbox(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const onShare = () => checkInbox();
        window.addEventListener('share:received', onShare);
        return () => window.removeEventListener('share:received', onShare);
    }, [checkInbox]);

    // ── PWA install prompt ────────────────────────────────────────────────
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

    // ── Data fetching ──────────────────────────────────────────────────────
    // The box stays instant; the network only sees the pauses between words.
    const debounced = useDebouncedValue(query);

    const foldersQ = useFolders();
    const contactsQ = useContacts();
    const notesQ = useVoiceNotes({ folderId, senderId, search: debounced });
    const waha = useWahaPolling({ interval: 30000, stopOnConnected: false });

    // ── Share routing modal callbacks ─────────────────────────────────────
    const handleShareComplete = useCallback(() => {
        setPendingShares([]);
        notesQ.refresh();
        contactsQ.refresh();
        toast.success('Voice note summarised and filed.', {
            key: 'share-done',
            title: 'Done',
        });
    }, [notesQ, contactsQ]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Navigation helpers ────────────────────────────────────────────────
    const selectFolder = useCallback(
        (id) => {
            setParams(id ? { folder: id } : {}, { replace: true });
            setDrawerOpen(false);
        },
        [setParams]
    );

    const selectContact = useCallback(
        (id) => {
            // A rail row is a toggle: clicking the active contact clears it.
            setParams(id && id !== senderId ? { sender: id } : {}, { replace: true });
            setDrawerOpen(false);
            // Reset search so the chat timeline starts fresh.
            setQuery('');
        },
        [setParams, senderId]
    );

    const goBack = useCallback(() => {
        setParams({}, { replace: true });
        setQuery('');
    }, [setParams]);

    // ── Error toasts ──────────────────────────────────────────────────────
    useEffect(() => {
        if (foldersQ.error) {
            toast.error(foldersQ.error.message || 'The server did not respond.', {
                key: 'folders',
                title: "Couldn't load folders",
                action: { label: 'Retry', onClick: foldersQ.refresh },
            });
        }
    }, [foldersQ.error, foldersQ.refresh]);

    // ── Derived state ──────────────────────────────────────────────────────
    const activeFolder = useMemo(
        () => foldersQ.folders.find((f) => f.id === folderId) ?? null,
        [foldersQ.folders, folderId]
    );

    // Deep links land here before /notes/contacts has answered, so we must be
    // able to name the scope from the URL alone.
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

    // True while what is on screen does not yet answer what is in the box.
    const searching =
        query.trim() !== debounced.trim() || (Boolean(debounced.trim()) && notesQ.loading);

    /**
     * The server does the deep search across every summary; this pass only
     * refines what came back, using the same OR-over-terms rule Mongo's `$text`
     * applies. It keeps the grid honest during the debounce window without
     * ever contradicting the ranking the backend just handed us.
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

    const reveal = location.state?.from === 'connect';
    const variants = reduce ? undefined : stagger(reveal ? 0.25 : 0.04, 0.05);

    // ── Keyboard shortcut: ⌘K / / to focus search ────────────────────────
    //
    // When the user triggers the search shortcut (or the mobile search button)
    // we CLEAR the senderId and folderId URL params before focusing. This
    // ensures every search is global — never silently scoped to one contact
    // or folder that the user may have forgotten is active.
    const focusSearch = useCallback(() => {
        // Transition to global scope if any filter is active.
        if (senderId || folderId) {
            setParams({}, { replace: true });
        }
        // Give React one tick to re-render the (now-visible) search input
        // before we focus it, so the ref is attached.
        requestAnimationFrame(() => {
            searchRef.current?.focus();
            searchRef.current?.select?.();
            searchRef.current?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        });
    }, [senderId, folderId, setParams, reduce]);

    useEffect(() => {
        const onKey = (e) => {
            const el = document.activeElement;
            const typing =
                Boolean(el) &&
                (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
            const combo = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
            const slash = e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
            if (!combo && !slash) return;
            e.preventDefault();
            focusSearch();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [focusSearch]);

    /* ------------------------------------------------------------------ */
    /*  Render                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * Whether the main area shows the chat list or the note timeline.
     * The chat list is the root surface; a selected senderId or folderId
     * zooms into a scoped timeline.
     *
     * `showSearch` is deliberately decoupled: the search bar is visible
     * whenever we are in a timeline OR the user has already typed a query.
     * This means a global-search session (query present, no sender/folder)
     * keeps the search bar rendered even though `inChatTimeline` is false.
     */
    const inChatTimeline = Boolean(senderId || folderId);
    const showSearch     = inChatTimeline || Boolean(query.trim());

    const scopeLabel = activeContact
        ? activeContact.name
        : activeFolder
          ? activeFolder.name
          : 'All notes';

    return (
        <AppShell reveal={reveal}>
            {/* ── Share Routing Modal ──────────────────────────────────── */}
            <AnimatePresence>
                {pendingShares.length > 0 && (
                    <ShareRoutingModal
                        key="share-modal"
                        items={pendingShares}
                        contacts={contactsQ.contacts}
                        onComplete={handleShareComplete}
                    />
                )}
            </AnimatePresence>

            <div className="mx-auto flex w-full max-w-[1600px] flex-1">
                {/* ── Desktop sidebar ──────────────────────────────────── */}
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
                    partition={partition}
                    onSelectPartition={(p) => setPartition(p)}
                />

                {/* ── Main content area ─────────────────────────────────── */}
                <div className="flex min-w-0 flex-1 flex-col px-4 pb-28 pt-5 sm:px-8 lg:px-12 lg:pb-16 lg:pt-10">

                    {/* Mobile top row */}
                    <div className="mb-6 flex items-center justify-between lg:hidden">
                        <Brand compact />
                        <div className="flex items-center gap-2">
                            <ConnectionPill status={waha.status} isConnected={waha.isConnected} />
                            <UserChip user={user} subtle />
                        </div>
                    </div>

                    {/* ── Page header ──────────────────────────────────── */}
                    <motion.header
                        initial={reduce ? false : 'hidden'}
                        animate="show"
                        variants={variants}
                        className="flex flex-col gap-6"
                    >
                        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
                            <div>
                                <motion.p variants={rise} className="eyebrow mb-3">
                                    {partition === 'analyzed'
                                        ? 'Partition · Analyzed Chats'
                                        : inChatTimeline
                                          ? `Library · ${scopeLabel}`
                                          : 'Library · Chats'}
                                </motion.p>

                                {/* Back button shown in chat timeline view */}
                                <AnimatePresence mode="wait" initial={false}>
                                    {inChatTimeline && partition === 'library' ? (
                                        <motion.div
                                            key="timeline-header"
                                            initial={reduce ? false : { opacity: 0, x: -8 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -8 }}
                                            transition={SPRING_SNAPPY}
                                            className="flex items-center gap-3"
                                        >
                                            <button
                                                type="button"
                                                onClick={goBack}
                                                aria-label="Back to chat list"
                                                className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-fog-400 shadow-hairline transition-[background-color,color] duration-150 hover:bg-white/[0.09] hover:text-fog-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60 lg:hidden"
                                            >
                                                <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                                            </button>
                                            <h1 className="text-display-sm text-fog-50">{scopeLabel}</h1>
                                        </motion.div>
                                    ) : (
                                        <motion.h1
                                            key="chats-header"
                                            variants={rise}
                                            initial={reduce ? false : 'hidden'}
                                            animate="show"
                                            className="text-display-sm text-fog-50"
                                        >
                                            {partition === 'analyzed' ? 'Analyzed Chats' : 'Dashboard'}
                                        </motion.h1>
                                    )}
                                </AnimatePresence>

                                <motion.p variants={riseSoft} className="mt-3 text-[15px] text-fog-400">
                                    Welcome{user?.name ? `, ${user.name}` : ''}.{' '}
                                    <span className="text-fog-500">
                                        {partition === 'analyzed'
                                            ? 'Full chat voice note bulk summaries & transcripts'
                                            : notesQ.loading && inChatTimeline
                                              ? 'Fetching notes…'
                                              : inChatTimeline
                                                ? `${filtered.length} ${filtered.length === 1 ? 'note' : 'notes'}${
                                                      foldersQ.folders.length
                                                          ? ` · ${foldersQ.folders.length} ${foldersQ.folders.length === 1 ? 'folder' : 'folders'}`
                                                          : ''
                                                  }`
                                                : `${contactsQ.contacts.length} ${contactsQ.contacts.length === 1 ? 'contact' : 'contacts'}`}
                                    </span>
                                </motion.p>
                            </div>

                            {/* Analyze All Button & Search Bar */}
                            <motion.div variants={riseSoft} className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                                <button
                                    type="button"
                                    onClick={() => setBulkModalOpen(true)}
                                    className="inline-flex h-11 items-center gap-2 rounded-xl2 bg-signal-400 px-4 text-[13.5px] font-bold text-ink-950 shadow-hairline transition-all duration-150 hover:bg-signal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                                >
                                    <Sparkles aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
                                    <span>Analyze All</span>
                                </button>

                                {showSearch && partition === 'library' && (
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
                                            onChange={(e) => {
                                                const next = e.target.value;
                                                if (next.trim() && (senderId || folderId)) {
                                                    setParams({}, { replace: true });
                                                }
                                                setQuery(next);
                                            }}
                                            placeholder={
                                                activeContact
                                                    ? `Search ${activeContact.name}'s notes`
                                                    : 'Search sender or summary'
                                            }
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
                                    </label>
                                )}

                                <ConnectionPill
                                    status={waha.status}
                                    isConnected={waha.isConnected}
                                    className="hidden lg:inline-flex"
                                />
                            </motion.div>
                        </div>

                        <motion.div
                            variants={riseSoft}
                            aria-hidden="true"
                            className="h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent"
                        />

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
                    </motion.header>

                    {/* ── Body: Analyzed Chats Partition OR Library Views ─────────────── */}
                    <AnimatePresence mode="wait" initial={false}>
                        {partition === 'analyzed' ? (
                            <motion.section
                                key="analyzed-chats"
                                initial={reduce ? false : { opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                                transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                                className="mt-8"
                            >
                                <AnalyzedChatsView onOpenAnalyzeModal={() => setBulkModalOpen(true)} />
                            </motion.section>
                        ) : !inChatTimeline ? (
                            /* ── Chat list (root view) ────────────────── */
                            <motion.section
                                key="chat-list"
                                initial={reduce ? false : { opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                                transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                                className="mt-8"
                                aria-labelledby="chats-heading"
                            >
                                <h2 id="chats-heading" className="sr-only">Chats</h2>
                                <ChatList
                                    contacts={contactsQ.contacts}
                                    onSelect={selectContact}
                                    loading={contactsQ.loading}
                                    linked={waha.isConnected}
                                />
                            </motion.section>
                        ) : (
                            /* ── Chat timeline (note grid for one sender) */
                            <motion.section
                                key={`timeline-${senderId ?? folderId ?? 'all'}`}
                                initial={reduce ? false : { opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={reduce ? { opacity: 0 } : { opacity: 0, x: -20 }}
                                transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                                className="mt-8"
                                aria-labelledby="notes-heading"
                            >
                                <div className="mb-4 flex items-baseline justify-between">
                                    <h2
                                        id="notes-heading"
                                        className="text-[17px] font-bold tracking-[-0.015em] text-fog-50"
                                    >
                                        {activeFolder
                                            ? activeFolder.name
                                            : activeContact
                                              ? activeContact.name
                                              : query
                                                ? 'Results'
                                                : 'Recent'}
                                    </h2>
                                    {notesQ.error && notesQ.notes.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={notesQ.refresh}
                                            className="font-mono text-[11px] uppercase tracking-[0.14em] text-ember-300 hover:text-ember-200"
                                        >
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
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* ── Mobile bottom nav ──────────────────────────────────── */}
            <MobileNav
                view={inChatTimeline ? 'folder' : 'all'}
                partition={partition}
                onNotes={() => {
                    setPartition('library');
                    if (inChatTimeline) goBack();
                }}
                onFolders={() => {
                    setPartition('library');
                    setDrawerOpen(true);
                }}
                onAnalyzed={() => setPartition('analyzed')}
                onSearch={focusSearch}
                linked={waha.isConnected}
            />

            {/* ── Mobile drawer ──────────────────────────────────────── */}
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

            {/* ── Bulk Analyze Modal ─────────────────────────────────── */}
            <BulkAnalyzeModal
                open={bulkModalOpen}
                onClose={() => setBulkModalOpen(false)}
                onLaunchSuccess={() => setPartition('analyzed')}
            />
        </AppShell>
    );
}
