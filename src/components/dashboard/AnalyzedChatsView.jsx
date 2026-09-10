/**
 * src/components/dashboard/AnalyzedChatsView.jsx
 * ------------------------------------------------------------------
 * Dedicated Partition for Analyzed Chats.
 * Shows all bulk-analyzed WhatsApp chats/batches with real-time status
 * updates, organized chat timelines, full verbatim transcripts, AI summaries,
 * audio playback, and deep search across the analyzed chat.
 * ------------------------------------------------------------------
 */

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, CheckCircle2, Clock, AlertCircle, Loader2, MessageSquare, Mic, Play, Pause, Search, Sparkles, X, RefreshCw, FileText } from 'lucide-react';
import { useBatchAnalyses, useBatchDetail } from '../../hooks/useLibrary';
import { initials } from '../format';
import { SPRING_SNAPPY } from '../motion';
import cx from '../ui/cx';

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

function StatusBadge({ status, processed, total }) {
    if (status === 'processing' || status === 'pending') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-400/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-signal-400 ring-1 ring-signal-400/30">
                <Loader2 className="h-3 w-3 animate-spin" />
                Processing {processed ?? 0}/{total ?? '?'}
            </span>
        );
    }
    if (status === 'completed') {
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-verdigris-400/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-verdigris-300 ring-1 ring-verdigris-400/30">
                <CheckCircle2 className="h-3 w-3" />
                Completed ({processed} items)
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-ember-400/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-ember-300 ring-1 ring-ember-400/30">
            <AlertCircle className="h-3 w-3" />
            Failed
        </span>
    );
}

function MessageCard({ note, search }) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [viewMode, setViewMode] = useState('summary'); // 'summary' | 'transcript'
    const audioRef = React.useRef(null);
    const isAudio = note.messageType === 'audio' || Boolean(note.originalAudioUrl);

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play();
            setIsPlaying(true);
        }
    };

    const formattedTime = useMemo(() => {
        if (!note.createdAt) return '';
        const d = new Date(note.createdAt);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + d.toLocaleDateString();
    }, [note.createdAt]);

    return (
        <motion.div
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass relative flex flex-col gap-3 rounded-2xl p-4 shadow-hairline transition-all hover:bg-white/[0.04]"
        >
            {isAudio && note.originalAudioUrl && (
                <audio
                    ref={audioRef}
                    src={note.originalAudioUrl}
                    onEnded={() => setIsPlaying(false)}
                    onPause={() => setIsPlaying(false)}
                />
            )}

            {/* Header: Sender & Time & Type Badge */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Avatar name={note.sender} size={36} />
                    <div>
                        <div className="flex items-center gap-2">
                            <h4 className="text-[13.5px] font-bold text-fog-50">{note.sender}</h4>
                            <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-mono uppercase text-fog-400">
                                {isAudio ? <Mic className="h-3 w-3 text-signal-400" /> : <MessageSquare className="h-3 w-3 text-verdigris-300" />}
                                {isAudio ? 'Voice Note' : 'Text'}
                            </span>
                        </div>
                        <span className="font-mono text-[10.5px] text-fog-500">{formattedTime}</span>
                    </div>
                </div>

                {/* Audio Play Button (if audio) */}
                {isAudio && note.originalAudioUrl && (
                    <button
                        type="button"
                        onClick={togglePlay}
                        className="flex h-9 items-center gap-2 rounded-xl bg-signal-400/10 px-3 text-[12.5px] font-bold text-signal-400 hover:bg-signal-400/20"
                    >
                        {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                        <span>{isPlaying ? 'Pause Audio' : 'Listen Note'}</span>
                    </button>
                )}
            </div>

            {/* View Toggle: Summary vs Full Message / Transcript */}
            <div className="flex items-center gap-2 border-t border-white/[0.06] pt-3">
                <button
                    type="button"
                    onClick={() => setViewMode('summary')}
                    className={cx(
                        'rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors',
                        viewMode === 'summary' ? 'bg-white/[0.09] text-fog-50' : 'text-fog-400 hover:text-fog-200'
                    )}
                >
                    Summary
                </button>
                {note.transcript && (
                    <button
                        type="button"
                        onClick={() => setViewMode('transcript')}
                        className={cx(
                            'rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors',
                            viewMode === 'transcript' ? 'bg-white/[0.09] text-fog-50' : 'text-fog-400 hover:text-fog-200'
                        )}
                    >
                        {isAudio ? 'Full Transcription' : 'Full Message'}
                    </button>
                )}
            </div>

            {/* Content Display */}
            <div className="rounded-xl bg-ink-950/40 p-3.5 text-[13.5px] leading-relaxed text-fog-200">
                {viewMode === 'summary' ? (
                    <p className="whitespace-pre-wrap">{note.summary || 'No summary generated.'}</p>
                ) : (
                    <p className="whitespace-pre-wrap font-sans text-fog-100">{note.transcript}</p>
                )}
            </div>
        </motion.div>
    );
}

export default function AnalyzedChatsView({ onOpenAnalyzeModal }) {
    const { batches, loading: batchesLoading, refresh: refreshBatches } = useBatchAnalyses();
    const [selectedBatchId, setSelectedBatchId] = useState(null);

    // Active batch selection default
    const activeBatchId = selectedBatchId || (batches.length > 0 ? batches[0].id : null);
    const { batch, notes, loading: detailLoading, refresh: refreshDetail } = useBatchDetail({ batchId: activeBatchId });

    const [chatQuery, setChatQuery] = useState('');

    const filteredNotes = useMemo(() => {
        const q = chatQuery.trim().toLowerCase();
        if (!q) return notes;
        return notes.filter(
            (n) =>
                (n.summary || '').toLowerCase().includes(q) ||
                (n.transcript || '').toLowerCase().includes(q) ||
                (n.sender || '').toLowerCase().includes(q)
        );
    }, [notes, chatQuery]);

    return (
        <div className="flex flex-col gap-6 lg:flex-row">
            {/* Analyzed Batches Rail / Sidebar */}
            <aside className="w-full shrink-0 space-y-3 lg:w-[320px]">
                <div className="flex items-center justify-between px-1">
                    <h3 className="eyebrow text-fog-400">Analyzed WhatsApp Chats</h3>
                    <button
                        type="button"
                        onClick={refreshBatches}
                        className="text-fog-400 hover:text-fog-100"
                        title="Refresh batches"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                </div>

                {batchesLoading && batches.length === 0 ? (
                    <div className="space-y-2">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" />
                        ))}
                    </div>
                ) : batches.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-white/10 p-6 text-center">
                        <Sparkles className="mx-auto h-7 w-7 text-signal-400/60" />
                        <p className="mt-2 text-[13px] text-fog-400">No analyzed chats yet.</p>
                        <button
                            type="button"
                            onClick={onOpenAnalyzeModal}
                            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-signal-400 px-3.5 py-2 text-[12.5px] font-bold text-ink-950"
                        >
                            Analyze First Chat
                        </button>
                    </div>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {batches.map((b) => {
                            const isSelected = b.id === activeBatchId;
                            return (
                                <li key={b.id}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedBatchId(b.id);
                                            setChatQuery('');
                                        }}
                                        className={cx(
                                            'group relative flex w-full flex-col gap-2 rounded-2xl p-3.5 text-left outline-none transition-all',
                                            isSelected
                                                ? 'bg-white/[0.08] ring-1 ring-signal-400/50 shadow-hairline'
                                                : 'hover:bg-white/[0.04]'
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Avatar name={b.chatName} picture={b.chatPicture} size={36} />
                                            <div className="min-w-0 flex-1">
                                                <h4 className="truncate text-[13.5px] font-bold text-fog-50">
                                                    {b.chatName}
                                                </h4>
                                                <span className="font-mono text-[10.5px] text-fog-500">
                                                    {b.startDate ? new Date(b.startDate).toLocaleDateString() : ''} - {b.endDate ? new Date(b.endDate).toLocaleDateString() : ''}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <StatusBadge status={b.status} processed={b.processedNotes} total={b.totalNotes} />
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </aside>

            {/* Main Analyzed Chat Timeline View */}
            <main className="flex-1 min-w-0 space-y-5">
                {batch ? (
                    <>
                        {/* Chat Header Bar */}
                        <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-3xl p-5 shadow-glass">
                            <div className="flex items-center gap-4">
                                <Avatar name={batch.chatName} picture={batch.chatPicture} size={48} />
                                <div>
                                    <h2 className="text-display-xs text-fog-50">{batch.chatName}</h2>
                                    <p className="mt-1 text-[13px] text-fog-400">
                                        Range: <span className="text-fog-200">{new Date(batch.startDate).toLocaleString()}</span> → <span className="text-fog-200">{new Date(batch.endDate).toLocaleString()}</span>
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <StatusBadge status={batch.status} processed={batch.processedNotes} total={batch.totalNotes} />
                                <button
                                    type="button"
                                    onClick={refreshDetail}
                                    className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-fog-300 hover:bg-white/[0.1]"
                                    title="Refresh chat notes"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        {/* Overall Chat Conversation Summary Banner */}
                        {batch.overallSummary ? (
                            <div className="rounded-3xl bg-gradient-to-r from-signal-400/[0.12] via-signal-400/[0.06] to-transparent p-5 ring-1 ring-signal-400/25">
                                <div className="flex items-center gap-2 mb-3">
                                    <Sparkles className="h-5 w-5 text-signal-400" />
                                    <h3 className="text-[15px] font-bold text-fog-50">Overall Conversation Summary</h3>
                                </div>
                                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-fog-100">
                                    {batch.overallSummary}
                                </p>
                            </div>
                        ) : batch.status === 'processing' ? (
                            <div className="rounded-2xl bg-signal-400/10 p-4 text-[13px] text-signal-300 flex items-center gap-3">
                                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                <span>Generating overall conversation summary as messages download in background…</span>
                            </div>
                        ) : null}

                        {/* Chat Deep Search Bar */}
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fog-500" />
                            <input
                                type="search"
                                value={chatQuery}
                                onChange={(e) => setChatQuery(e.target.value)}
                                placeholder={`Search inside ${batch.chatName}'s analyzed content…`}
                                className="h-11 w-full rounded-2xl bg-ink-900/80 pl-10 pr-9 text-[14px] text-fog-50 outline-none ring-1 ring-white/[0.08] focus:ring-signal-400/70"
                            />
                            {chatQuery && (
                                <button
                                    type="button"
                                    onClick={() => setChatQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fog-400 hover:text-fog-50"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>

                        {/* Messages & Audio Notes Timeline */}
                        {detailLoading && notes.length === 0 ? (
                            <div className="space-y-3 py-6">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/[0.04]" />
                                ))}
                            </div>
                        ) : filteredNotes.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-white/10 p-12 text-center text-fog-400">
                                {chatQuery ? (
                                    <p>No content in this chat matches "{chatQuery}".</p>
                                ) : batch.status === 'processing' ? (
                                    <div className="flex flex-col items-center gap-2">
                                        <Loader2 className="h-6 w-6 animate-spin text-signal-400" />
                                        <p>Downloading and transcribing chat content in background…</p>
                                    </div>
                                ) : (
                                    <p>No text or voice notes found in this chat for the selected date range.</p>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {filteredNotes.map((note) => (
                                    <MessageCard key={note.id} note={note} search={chatQuery} />
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="glass flex h-64 flex-col items-center justify-center rounded-3xl p-8 text-center text-fog-400">
                        <Sparkles className="h-8 w-8 text-signal-400/50 mb-2" />
                        <p className="text-[14px]">Select an analyzed chat from the list or launch a new analysis.</p>
                    </div>
                )}
            </main>
        </div>
    );
}
