import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';

/**
 * Endpoint assumptions (single place to change if the backend differs):
 *   GET /api/folders           → Folder[]  | { folders: Folder[] } | { data: Folder[] }
 *   GET /api/notes?folder=<id> → Note[]    | { notes: Note[] }     | { data: Note[] }
 */
export const ENDPOINTS = {
    folders: '/folders',
    notes: '/notes',
};

export function unwrapList(payload, keys = []) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    for (const k of [...keys, 'data', 'items', 'results']) {
        if (Array.isArray(payload[k])) return payload[k];
    }
    return [];
}

export function normalizeFolder(raw) {
    return {
        id: String(raw._id ?? raw.id ?? raw.slug ?? raw.name),
        name: raw.name ?? raw.title ?? 'Untitled',
        count: raw.count ?? raw.noteCount ?? raw.notes?.length ?? null,
        color: raw.color ?? null,
    };
}

export function normalizeNote(raw) {
    const folder = raw.folder ?? raw.folderId ?? null;
    return {
        id: String(raw._id ?? raw.id),
        title: raw.title ?? null,
        summary: raw.summary ?? raw.text ?? raw.content ?? '',
        transcript: raw.transcript ?? raw.transcription ?? null,
        sender: raw.sender ?? raw.from ?? raw.contact ?? raw.pushName ?? 'Unknown',
        durationSec: raw.durationSec ?? raw.duration ?? raw.seconds ?? null,
        createdAt: raw.createdAt ?? raw.timestamp ?? raw.date ?? null,
        folderId: folder && typeof folder === 'object' ? String(folder._id ?? folder.id) : folder ? String(folder) : null,
        folderName: folder && typeof folder === 'object' ? folder.name : raw.folderName ?? null,
        tags: Array.isArray(raw.tags) ? raw.tags : [],
    };
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

export function useVoiceNotes({ client = api, folderId = null, enabled = true } = {}) {
    const { data, error, loading, refresh } = useResource(
        async (signal) => {
            const params = folderId ? { folder: folderId } : undefined;
            const res = await client.get(ENDPOINTS.notes, { signal, params });
            return unwrapList(res?.data, ['notes', 'voiceNotes']).map(normalizeNote);
        },
        [client, folderId],
        { enabled }
    );
    const notes = useMemo(
        () => (data ?? []).slice().sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0)),
        [data]
    );
    return { notes, error, loading, refresh };
}
