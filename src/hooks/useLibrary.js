import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { contactHandle } from '../components/format';

/**
 * Endpoint assumptions (single place to change if the backend differs):
 *   GET /api/folders                     → Folder[]   | { folders: Folder[] }   | { data: Folder[] }
 *   GET /api/notes/contacts              → Contact[]  | { contacts: Contact[] } | { data: Contact[] }
 *   GET /api/notes?folder=&sender=&search=
 *                                        → Note[]     | { notes: Note[] }       | { data: Note[] }
 */
export const ENDPOINTS = {
    folders: '/folders',
    notes: '/notes',
    contacts: '/notes/contacts',
    batches: '/ai/batches',
};

/** How long the search box stays quiet before it hits the deep-search API. */
export const SEARCH_DEBOUNCE_MS = 220;

export function unwrapList(payload, keys = []) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    for (const k of [...keys, 'data', 'items', 'results']) {
        if (Array.isArray(payload[k])) return payload[k];
    }
    return [];
}

export function normalizeBatch(raw) {
    if (!raw) return null;
    return {
        id: String(raw._id ?? raw.id),
        chatId: raw.chatId ?? '',
        chatName: raw.chatName || contactHandle(raw.chatId) || 'WhatsApp Chat',
        chatPicture: raw.chatPicture ?? null,
        startDate: raw.startDate ?? null,
        endDate: raw.endDate ?? null,
        status: raw.status ?? 'pending',
        totalNotes: raw.totalNotes ?? 0,
        processedNotes: raw.processedNotes ?? 0,
        failedNotes: raw.failedNotes ?? 0,
        error: raw.error ?? null,
        overallSummary: raw.overallSummary ?? '',
        createdAt: raw.createdAt ?? null,
    };
}

export function normalizeFolder(raw) {
    return {
        id: String(raw._id ?? raw.id ?? raw.slug ?? raw.name),
        name: raw.name ?? raw.title ?? 'Untitled',
        count: raw.count ?? raw.noteCount ?? raw.notes?.length ?? null,
        color: raw.color ?? null,
    };
}

/**
 * A contact row for the sidebar rail.
 *
 * The name fallback chain is duplicated from the backend on purpose: the API
 * already resolves `name`, but a cached/offline payload (or a future consumer
 * that only stores `senderName`) must not render an empty row.
 */
export function normalizeContact(raw) {
    const id = String(raw.senderId ?? raw.id ?? raw._id ?? '');
    const handle = contactHandle(id);
    const known = (raw.name ?? raw.senderName ?? raw.pushName ?? '').trim();
    const name = known || handle || 'Unknown Contact';

    return {
        id,
        name,
        // Only worth a second line when it says something the name does not.
        handle: handle && handle !== name ? handle : null,
        count: raw.count ?? raw.noteCount ?? null,
        lastNoteAt: raw.lastNoteAt ?? raw.lastAt ?? raw.updatedAt ?? null,
    };
}

export function normalizeNote(raw) {
    const folder = raw.folder ?? raw.folderId ?? null;
    const senderId = raw.senderId ?? null;
    return {
        id: String(raw._id ?? raw.id),
        title: raw.title ?? null,
        summary: raw.summary ?? raw.text ?? raw.content ?? '',
        transcript: raw.transcript ?? raw.transcription ?? null,
        sender:
            raw.sender ??
            raw.senderName ??
            raw.from ??
            raw.contact ??
            raw.pushName ??
            contactHandle(senderId) ??
            'Unknown Contact',
        senderId: senderId ? String(senderId) : null,
        durationSec: raw.durationSec ?? raw.duration ?? raw.seconds ?? null,
        originalAudioUrl: raw.originalAudioUrl ?? null,
        messageType: raw.messageType ?? (raw.originalAudioUrl ? 'audio' : 'text'),
        createdAt: raw.createdAt ?? raw.timestamp ?? raw.date ?? null,
        folderId: folder && typeof folder === 'object' ? String(folder._id ?? folder.id) : folder ? String(folder) : null,
        folderName: folder && typeof folder === 'object' ? folder.name : raw.folderName ?? null,
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        score: raw.score ?? null,
    };
}

/**
 * Trailing-edge debounce. Returns `value` only once it has stopped changing
 * for `delay` ms, so the search box can stay perfectly responsive while the
 * network sees one request per pause rather than one per keystroke.
 */
export function useDebouncedValue(value, delay = SEARCH_DEBOUNCE_MS) {
    const [settled, setSettled] = useState(value);

    useEffect(() => {
        if (value === settled) return undefined;
        const t = setTimeout(() => setSettled(value), delay);
        return () => clearTimeout(t);
    }, [value, delay, settled]);

    return settled;
}

function useResource(fetcher, deps, { enabled = true } = {}) {
    const [state, setState] = useState({ data: null, error: null, loading: enabled });
    const abortRef = useRef(null);
    const mountedRef = useRef(false);

    const load = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setState((s) => ({ ...s, loading: true, error: null }));
        try {
            const data = await fetcher(controller.signal);
            if (!mountedRef.current || controller.signal.aborted) return;
            setState({ data, error: null, loading: false });
        } catch (err) {
            if (!mountedRef.current || controller.signal.aborted) return;
            if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
            setState((s) => ({ ...s, error: err, loading: false }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    useEffect(() => {
        mountedRef.current = true;
        if (enabled) load();
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
        };
    }, [load, enabled]);

    return { ...state, refresh: load };
}

export function useFolders({ client = api, enabled = true } = {}) {
    const { data, error, loading, refresh } = useResource(
        async (signal) => {
            const res = await client.get(ENDPOINTS.folders, { signal });
            return unwrapList(res?.data, ['folders']).map(normalizeFolder);
        },
        [client],
        { enabled }
    );
    return { folders: data ?? [], error, loading, refresh };
}

/**
 * Unique senders across the tenant's notes, newest conversation first.
 * Sorted client-side too, so the rail order is stable even if a future backend
 * returns them unordered.
 */
export function useContacts({ client = api, enabled = true } = {}) {
    const { data, error, loading, refresh } = useResource(
        async (signal) => {
            const res = await client.get(ENDPOINTS.contacts, { signal });
            return unwrapList(res?.data, ['contacts', 'senders']).map(normalizeContact);
        },
        [client],
        { enabled }
    );

    const contacts = useMemo(() => {
        const rows = (data ?? []).filter((c) => c.id);
        return rows
            .slice()
            .sort((a, b) => new Date(b.lastNoteAt ?? 0) - new Date(a.lastNoteAt ?? 0) || a.name.localeCompare(b.name));
    }, [data]);

    return { contacts, error, loading, refresh };
}

/**
 * Notes for the current filter set.
 *
 * `search` is expected to be *already debounced* by the caller — this hook
 * fires a request whenever it changes. When the backend is doing the
 * searching, results arrive ranked by relevance, so we only re-sort by date
 * when no search is active.
 */
export function useVoiceNotes({ client = api, folderId = null, senderId = null, search = '', enabled = true } = {}) {
    const term = typeof search === 'string' ? search.trim() : '';

    const { data, error, loading, refresh } = useResource(
        async (signal) => {
            const params = {};
            if (folderId) params.folder = folderId;
            if (senderId) params.sender = senderId;
            if (term) params.search = term;

            const res = await client.get(ENDPOINTS.notes, {
                signal,
                ...(Object.keys(params).length ? { params } : {}),
            });
            return unwrapList(res?.data, ['notes', 'voiceNotes']).map(normalizeNote);
        },
        [client, folderId, senderId, term],
        { enabled }
    );

    const notes = useMemo(() => {
        const rows = data ?? [];
        // Relevance order is the point of a text search – don't clobber it.
        if (term) return rows;
        return rows.slice().sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
    }, [data, term]);

    return { notes, error, loading, refresh };
}

/**
 * Fetch list of user's bulk batch analyses, with optional polling for active jobs.
 */
export function useBatchAnalyses({ client = api, enabled = true, pollInterval = 4000 } = {}) {
    const { data, error, loading, refresh } = useResource(
        async (signal) => {
            const res = await client.get(ENDPOINTS.batches, { signal });
            return unwrapList(res?.data, ['batches']).map(normalizeBatch).filter(Boolean);
        },
        [client],
        { enabled }
    );

    const hasProcessing = useMemo(() => {
        return (data ?? []).some((b) => b.status === 'processing' || b.status === 'pending');
    }, [data]);

    useEffect(() => {
        if (!enabled || !hasProcessing) return;
        const interval = setInterval(() => {
            refresh();
        }, pollInterval);
        return () => clearInterval(interval);
    }, [enabled, hasProcessing, pollInterval, refresh]);

    return { batches: data ?? [], error, loading, refresh };
}

/**
 * Fetch detail and notes of a specific bulk batch analysis.
 */
export function useBatchDetail({ client = api, batchId = null, enabled = true, pollInterval = 3000 } = {}) {
    const { data, error, loading, refresh } = useResource(
        async (signal) => {
            if (!batchId) return null;
            const res = await client.get(`${ENDPOINTS.batches}/${encodeURIComponent(batchId)}`, { signal });
            const batch = normalizeBatch(res?.data?.batch);
            const notes = unwrapList(res?.data?.notes, ['notes']).map(normalizeNote);
            return { batch, notes };
        },
        [client, batchId],
        { enabled: enabled && Boolean(batchId) }
    );

    const isProcessing = data?.batch?.status === 'processing' || data?.batch?.status === 'pending';

    useEffect(() => {
        if (!enabled || !batchId || !isProcessing) return;
        const interval = setInterval(() => {
            refresh();
        }, pollInterval);
        return () => clearInterval(interval);
    }, [enabled, batchId, isProcessing, pollInterval, refresh]);

    return {
        batch: data?.batch ?? null,
        notes: data?.notes ?? [],
        error,
        loading,
        refresh,
    };
}
