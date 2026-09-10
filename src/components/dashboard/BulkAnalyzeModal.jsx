/**
 * src/components/dashboard/BulkAnalyzeModal.jsx
 * ------------------------------------------------------------------
 * Modal wizard for initiating a Bulk Voice Note Analysis ("Analyze All")
 * on any live WhatsApp chat over a specified date & time range.
 *
 * Steps:
 *   1. Choose a real WhatsApp chat from the live session list.
 *   2. Select Start Date/Time and End Date/Time (with quick presets).
 *   3. Confirm & trigger non-blocking background analysis.
 * ------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Calendar, Check, Clock, Layers, Loader2, Mic, Search, Sparkles, X } from 'lucide-react';
import api from '../../services/api';
import { initials, contactHandle } from '../format';
import { SPRING_SNAPPY, SPRING_SOFT } from '../motion';
import { toast } from '../ui/toast';
import Button from '../ui/Button';
import cx from '../ui/cx';

const PAGE_SIZE = 25;

function normaliseRow(raw) {
    const id = String(raw.id ?? raw.senderId ?? '');
    const handle = contactHandle(id);
    const name = (raw.name ?? raw.senderName ?? '').trim() || handle || 'WhatsApp Contact';
    return {
        id,
        name,
        handle: handle && handle !== name ? handle : null,
        picture: raw.picture ?? null,
        lastMessage: raw.lastMessage ?? null,
    };
}

function Avatar({ name, picture, size = 40 }) {
    const [imgError, setImgError] = useState(false);
    if (picture && !imgError) {
        return (
            <img
                src={picture}
                alt=""
                onError={() => setImgError(true)}
                className="shrink-0 rounded-full object-cover"
                style={{ width: size, height: size }}
            />
        );
    }
    return (
        <span
            aria-hidden="true"
            className="grid shrink-0 place-items-center rounded-full bg-ink-700 font-mono font-bold text-verdigris-300 shadow-hairline"
            style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}
        >
            {initials(name)}
        </span>
    );
}

function toLocalDatetimeString(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export default function BulkAnalyzeModal({ open, onClose, onLaunchSuccess }) {
    const reduce = useReducedMotion();

    // Wizard step: 1 = Chat selection, 2 = Date/Time selection
    const [step, setStep] = useState(1);
    const [selectedChat, setSelectedChat] = useState(null);

    // ── Date/Time State ───────────────────────────────────────────────────
    const [preset, setPreset] = useState('7d'); // 'today' | '7d' | '30d' | 'custom'
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return toLocalDatetimeString(d);
    });
    const [endDate, setEndDate] = useState(() => toLocalDatetimeString(new Date()));

    // ── Chats list state ──────────────────────────────────────────────────
    const [wahaChats, setWahaChats] = useState([]);
    const [chatsLoading, setChatsLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [launching, setLaunching] = useState(false);
    const searchRef = useRef(null);

    const fetchChats = useCallback(async () => {
        setChatsLoading(true);
        try {
            const res = await api.get('/waha/chats', { params: { limit: PAGE_SIZE, offset: 0 } });
            const { chats = [] } = res.data;
            setWahaChats(chats.map(normaliseRow));
        } catch {
            setWahaChats([]);
        } finally {
            setChatsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) {
            setStep(1);
            setSelectedChat(null);
            setQuery('');
            fetchChats();
        }
    }, [open, fetchChats]);

    // Handle preset changes
    const applyPreset = useCallback((presetKey) => {
        setPreset(presetKey);
        const now = new Date();
        const endStr = toLocalDatetimeString(now);

        if (presetKey === 'today') {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            setStartDate(toLocalDatetimeString(start));
            setEndDate(endStr);
        } else if (presetKey === '7d') {
            const start = new Date(now);
            start.setDate(start.getDate() - 7);
            setStartDate(toLocalDatetimeString(start));
            setEndDate(endStr);
        } else if (presetKey === '30d') {
            const start = new Date(now);
            start.setDate(start.getDate() - 30);
            setStartDate(toLocalDatetimeString(start));
            setEndDate(endStr);
        }
    }, []);

    const filteredChats = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return wahaChats;
        return wahaChats.filter((c) => c.name.toLowerCase().includes(q) || (c.handle ?? '').toLowerCase().includes(q));
    }, [wahaChats, query]);

    const handleSelectChat = (chat) => {
        setSelectedChat(chat);
        setStep(2);
    };

    const handleStartAnalysis = async () => {
        if (!selectedChat) return;
        const sDate = new Date(startDate);
        const eDate = new Date(endDate);

        if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
            toast.error('Please enter valid start and end dates.');
            return;
        }
        if (sDate > eDate) {
            toast.error('Start date must be before or equal to end date.');
            return;
        }

        setLaunching(true);
        try {
            const res = await api.post('/ai/batch-analyze', {
                chatId: selectedChat.id,
                chatName: selectedChat.name,
                chatPicture: selectedChat.picture,
                startDate: sDate.toISOString(),
                endDate: eDate.toISOString(),
            });

            toast.success(
                `Bulk analysis started for ${selectedChat.name}! Voice notes will download in the background.`,
                { key: 'batch-started', title: 'Analysis Launched' }
            );

            onClose();
            if (onLaunchSuccess) {
                onLaunchSuccess(res.data);
            }
        } catch (err) {
            toast.error(err.message || 'Failed to start bulk analysis', { title: 'Error' });
        } finally {
            setLaunching(false);
        }
    };

    if (!open) return null;

    return createPortal(
        <AnimatePresence>
            <div key="analyze-modal-container" className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
                {/* Backdrop */}
                <motion.div
                    key="analyze-modal-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-ink-950/80 backdrop-blur-md"
                    aria-hidden="true"
                />

                {/* Modal Sheet */}
                <motion.div
                    key="analyze-modal-sheet"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Analyze All Voice Notes"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
                    transition={SPRING_SOFT}
                    className="glass relative z-[61] flex w-full max-h-[85vh] sm:max-h-[90vh] max-w-lg flex-col rounded-3xl border border-white/10 bg-ink-950/95 shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
                    <div className="flex items-center gap-3">
                        {step === 2 && (
                            <button
                                type="button"
                                onClick={() => setStep(1)}
                                aria-label="Back to chat selection"
                                className="grid h-8 w-8 place-items-center rounded-xl bg-white/[0.05] text-fog-300 hover:bg-white/[0.1] hover:text-fog-50"
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </button>
                        )}
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-signal-400/[0.15] text-signal-400">
                            <Sparkles className="h-4.5 w-4.5" strokeWidth={2} />
                        </span>
                        <div>
                            <h2 className="text-[16px] font-bold text-fog-50">
                                {step === 1 ? 'Analyze All Voice Notes' : 'Set Date & Time Range'}
                            </h2>
                            <p className="text-[12px] text-fog-400">
                                {step === 1 ? 'Select a WhatsApp chat to analyze' : `Chat: ${selectedChat?.name}`}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close modal"
                        className="grid h-8 w-8 place-items-center rounded-xl text-fog-400 hover:bg-white/[0.06] hover:text-fog-50"
                    >
                        <X className="h-4 w-4" strokeWidth={2.25} />
                    </button>
                </header>

                {/* Step 1: Select Chat */}
                {step === 1 && (
                    <div className="flex min-h-0 flex-1 flex-col">
                        {/* Search input */}
                        <div className="px-5 pt-4 pb-3">
                            <label className="group relative flex h-10 items-center">
                                <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-fog-500 group-focus-within:text-signal-400" />
                                <input
                                    ref={searchRef}
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search WhatsApp chats…"
                                    className="h-full w-full rounded-xl bg-ink-900/80 pl-10 pr-8 text-[13.5px] text-fog-50 outline-none ring-1 ring-white/[0.08] focus:ring-signal-400/70"
                                />
                                {query && (
                                    <button
                                        type="button"
                                        onClick={() => setQuery('')}
                                        className="absolute right-2.5 grid h-6 w-6 place-items-center text-fog-400 hover:text-fog-100"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </label>
                        </div>

                        {/* Chats list */}
                        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 [scrollbar-width:thin]">
                            {chatsLoading ? (
                                <div className="flex flex-col gap-2 py-6">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="flex h-14 items-center gap-3.5 px-3">
                                            <div className="h-10 w-10 animate-pulse rounded-full bg-white/[0.06]" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-3.5 w-1/3 animate-pulse rounded bg-white/[0.07]" />
                                                <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : filteredChats.length === 0 ? (
                                <div className="py-12 text-center text-[13.5px] text-fog-400">
                                    No WhatsApp chats found. Ensure WhatsApp is connected in your settings.
                                </div>
                            ) : (
                                <ul className="flex flex-col gap-1 py-1">
                                    {filteredChats.map((chat) => (
                                        <li key={chat.id}>
                                            <button
                                                type="button"
                                                onClick={() => handleSelectChat(chat)}
                                                className="group flex w-full items-center gap-3.5 rounded-2xl p-3 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                                            >
                                                <Avatar name={chat.name} picture={chat.picture} size={42} />
                                                <div className="min-w-0 flex-1">
                                                    <h3 className="truncate text-[14px] font-semibold text-fog-50">
                                                        {chat.name}
                                                    </h3>
                                                    {chat.lastMessage?.body && (
                                                        <p className="truncate text-[12.5px] text-fog-400">
                                                            {chat.lastMessage.body}
                                                        </p>
                                                    )}
                                                </div>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 2: Date & Time Selection */}
                {step === 2 && (
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
                            {/* Selected Chat Header Pill */}
                            <div className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3.5 ring-1 ring-white/[0.08]">
                                <Avatar name={selectedChat.name} picture={selectedChat.picture} size={40} />
                                <div className="min-w-0 flex-1">
                                    <p className="eyebrow text-[10px] text-signal-400">Selected Target Chat</p>
                                    <h4 className="truncate text-[14px] font-bold text-fog-50">{selectedChat.name}</h4>
                                </div>
                            </div>

                            {/* Quick Presets */}
                            <div>
                                <label className="eyebrow mb-2.5 block text-fog-400">Quick Date Presets</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: 'today', label: 'Today' },
                                        { id: '7d', label: 'Last 7 Days' },
                                        { id: '30d', label: 'Last 30 Days' },
                                    ].map((p) => (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => applyPreset(p.id)}
                                            className={cx(
                                                'flex h-9 items-center justify-center rounded-xl text-[13px] font-medium transition-all',
                                                preset === p.id
                                                    ? 'bg-signal-400 text-ink-950 font-bold shadow-md'
                                                    : 'bg-white/[0.05] text-fog-300 hover:bg-white/[0.09] hover:text-fog-50'
                                            )}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Explicit Start & End Date/Time inputs */}
                            <div className="space-y-4">
                                <div>
                                    <label className="eyebrow mb-1.5 flex items-center gap-1.5 text-fog-300">
                                        <Calendar className="h-3.5 w-3.5 text-signal-400" /> Start Date & Time
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={startDate}
                                        onChange={(e) => {
                                            setPreset('custom');
                                            setStartDate(e.target.value);
                                        }}
                                        className="h-11 w-full rounded-xl bg-ink-900/90 px-3.5 text-[13.5px] text-fog-50 outline-none ring-1 ring-white/[0.12] focus:ring-signal-400/80"
                                    />
                                </div>

                                <div>
                                    <label className="eyebrow mb-1.5 flex items-center gap-1.5 text-fog-300">
                                        <Clock className="h-3.5 w-3.5 text-signal-400" /> End Date & Time
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={endDate}
                                        onChange={(e) => {
                                            setPreset('custom');
                                            setEndDate(e.target.value);
                                        }}
                                        className="h-11 w-full rounded-xl bg-ink-900/90 px-3.5 text-[13.5px] text-fog-50 outline-none ring-1 ring-white/[0.12] focus:ring-signal-400/80"
                                    />
                                </div>
                            </div>

                            {/* Notice */}
                            <div className="rounded-xl bg-verdigris-400/[0.08] p-3 text-[12.5px] leading-relaxed text-verdigris-100 ring-1 ring-verdigris-400/20">
                                <strong>Non-blocking task:</strong> All text messages and voice notes in this range will be summarized, along with an overall conversation summary. Processing runs in the background.
                            </div>
                        </div>

                        {/* Always-visible Sticky Footer */}
                        <footer className="shrink-0 border-t border-white/[0.08] bg-ink-950/95 p-4 backdrop-blur-md">
                            <Button
                                variant="primary"
                                loading={launching}
                                loadingLabel="Launching background job…"
                                onClick={handleStartAnalysis}
                                className="h-12 w-full text-[15px] font-bold shadow-lg"
                            >
                                Submit & Start Analysis
                            </Button>
                        </footer>
                    </div>
                )}
            </motion.div>
            </div>
        </AnimatePresence>,
        document.body
    );
}
