import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';

/** Turn whatever the backend hands us into something an <img> can render. */
export function toImageSrc(value) {
    if (!value) return null;
    if (typeof value !== 'string') {
        return toImageSrc(value.qr ?? value.qrCode ?? value.image ?? value.base64 ?? value.value ?? value.data);
    }
    if (value.startsWith('data:') || value.startsWith('http') || value.startsWith('blob:')) return value;
    // Raw base64 PNG
    if (/^[A-Za-z0-9+/=]+$/.test(value.slice(0, 64))) return `data:image/png;base64,${value}`;
    return value;
}

/**
 * Resolves the QR image for pairing.
 *
 *  - If the status payload already carries a QR (`source`), use it as-is.
 *  - Otherwise fetch `GET /api/waha/qr` while `enabled`, accepting either an
 *    image body (→ object URL) or JSON containing a data URL / base64.
 *  - Re-fetches every `refreshEvery` ms because WhatsApp rotates codes.
 */
export default function useWahaQr({
    enabled = false,
    source = null,
    path = '/waha/qr',
    client = api,
    refreshEvery = 20000,
    timeout = 8000,
} = {}) {
    const [fetched, setFetched] = useState({ src: null, error: null, loading: false, fetchedAt: null });
    const objectUrlRef = useRef(null);
    const mountedRef = useRef(false);
    const abortRef = useRef(null);

    const sourceSrc = toImageSrc(source);

    const release = () => {
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
    };

    const fetchQr = useCallback(async () => {
        if (!mountedRef.current) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setFetched((s) => ({ ...s, loading: true }));

        try {
            const res = await client.get(path, { signal: controller.signal, timeout, responseType: 'blob' });
            if (!mountedRef.current || controller.signal.aborted) return;

            const contentType = res?.headers?.['content-type'] ?? res?.headers?.get?.('content-type') ?? '';
            let src = null;

            if (typeof Blob !== 'undefined' && res.data instanceof Blob) {
                if (contentType.startsWith('image/') || res.data.type?.startsWith('image/')) {
                    release();
                    objectUrlRef.current = URL.createObjectURL(res.data);
                    src = objectUrlRef.current;
                } else {
                    const text = await res.data.text();
                    try {
                        src = toImageSrc(JSON.parse(text));
                    } catch {
                        src = toImageSrc(text);
                    }
                }
            } else {
                src = toImageSrc(res?.data);
            }

            if (!src) throw new Error('The server did not return a QR code.');
            setFetched({ src, error: null, loading: false, fetchedAt: Date.now() });
        } catch (err) {
            if (!mountedRef.current || controller.signal.aborted) return;
            setFetched((s) => ({ ...s, error: err, loading: false }));
        }
    }, [client, path, timeout]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
            release();
        };
    }, []);

    useEffect(() => {
        if (!enabled || sourceSrc) return undefined;
        fetchQr();
        const id = setInterval(fetchQr, refreshEvery);
        return () => clearInterval(id);
    }, [enabled, sourceSrc, fetchQr, refreshEvery]);

    return {
        qr: sourceSrc ?? fetched.src,
        loading: !sourceSrc && fetched.loading,
        error: sourceSrc ? null : fetched.error,
        fetchedAt: fetched.fetchedAt,
        refresh: fetchQr,
    };
}
