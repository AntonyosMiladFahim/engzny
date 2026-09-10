import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';

/**
 * Statuses the backend/WAHA may report. WAHA's own vocabulary is
 * STOPPED → STARTING → SCAN_QR_CODE → WORKING (+ FAILED); our API may also
 * say CONNECTED. Anything in CONNECTED_STATUSES counts as "linked".
 */
export const CONNECTED_STATUSES = ['CONNECTED', 'WORKING', 'AUTHENTICATED'];
export const SCAN_STATUSES = ['SCAN_QR_CODE', 'QR', 'SCAN'];
export const FAILED_STATUSES = ['FAILED', 'ERROR'];

export function normalizeStatus(payload) {
    if (payload == null) return null;
    const raw =
        typeof payload === 'string'
            ? payload
            : payload.status ?? payload.state ?? payload.data?.status ?? payload.session?.status;
    return raw ? String(raw).trim().toUpperCase() : null;
}

export const isConnectedStatus = (s) => CONNECTED_STATUSES.includes(s);
export const isScanStatus = (s) => SCAN_STATUSES.includes(s);
export const isFailedStatus = (s) => FAILED_STATUSES.includes(s);

const isCancel = (err) =>
    err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError';

/**
 * Polls `GET /api/waha/status` on a fixed cadence with these guarantees:
 *
 *  - Never overlaps requests: the next tick is scheduled only after the
 *    current one settles (setTimeout chain, not setInterval).
 *  - Per-request timeout + AbortController; aborts on unmount/refresh/hide.
 *  - Gentle backoff on consecutive failures (×1.5, capped at `maxInterval`),
 *    resetting on the first success. `nextAt` exposes when the retry lands
 *    so the UI can show "retrying in 4s".
 *  - Pauses while the tab is hidden, polls immediately on return.
 *  - `onConnected` fires exactly once per mount when a connected status is
 *    first observed; polling stops there unless `stopOnConnected` is false.
 */
export default function useWahaPolling({
    interval = 3000,
    maxInterval = 15000,
    timeout = 8000,
    enabled = true,
    path = '/waha/status',
    client = api,
    stopOnConnected = true,
    pauseWhenHidden = true,
    onConnected,
    onStatusChange,
    onError,
} = {}) {
    const [snapshot, setSnapshot] = useState({
        status: null,
        data: null,
        error: null,
        failures: 0,
        lastUpdated: null,
    });
    const [isPolling, setIsPolling] = useState(false);
    const [nextAt, setNextAt] = useState(null);
    const [stopped, setStopped] = useState(false);

    const timerRef = useRef(null);
    const abortRef = useRef(null);
    const inFlightRef = useRef(false);
    const mountedRef = useRef(false);
    const stoppedRef = useRef(false);
    const pausedRef = useRef(false);
    const refreshQueuedRef = useRef(false);
    const connectedFiredRef = useRef(false);
    const failuresRef = useRef(0);
    const statusRef = useRef(null);
    const pollRef = useRef(() => {});

    // Latest callbacks without re-subscribing effects.
    const callbacksRef = useRef({});
    callbacksRef.current = { onConnected, onStatusChange, onError };

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setNextAt(null);
    }, []);

    const schedule = useCallback(
        (delay) => {
            clearTimer();
            if (!mountedRef.current || stoppedRef.current) return;
            setNextAt(Date.now() + delay);
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                setNextAt(null);
                pollRef.current();
            }, delay);
        },
        [clearTimer]
    );

    const poll = useCallback(async () => {
        if (!mountedRef.current || stoppedRef.current || inFlightRef.current) return;
        if (pauseWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            pausedRef.current = true;
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        inFlightRef.current = true;
        setIsPolling(true);

        try {
            const res = await client.get(path, { signal: controller.signal, timeout });
            if (!mountedRef.current || controller.signal.aborted) return;

            const payload = res?.data ?? res;
            const status = normalizeStatus(payload);
            failuresRef.current = 0;

            const changed = status !== statusRef.current;
            statusRef.current = status;
            setSnapshot({ status, data: payload, error: null, failures: 0, lastUpdated: Date.now() });
            if (changed) callbacksRef.current.onStatusChange?.(status, payload);

            if (isConnectedStatus(status)) {
                if (!connectedFiredRef.current) {
                    connectedFiredRef.current = true;
                    callbacksRef.current.onConnected?.(payload);
                }
                if (stopOnConnected) {
                    stoppedRef.current = true;
                    setStopped(true);
                    return;
                }
            }
            schedule(interval);
        } catch (err) {
            if (!mountedRef.current || controller.signal.aborted || isCancel(err)) return;

            failuresRef.current += 1;
            const failures = failuresRef.current;
            setSnapshot((s) => ({ ...s, error: err, failures, lastUpdated: Date.now() }));
            callbacksRef.current.onError?.(err, failures);

            const delay = Math.min(Math.round(interval * 1.5 ** (failures - 1)), maxInterval);
            schedule(delay);
        } finally {
            inFlightRef.current = false;
            if (mountedRef.current) setIsPolling(false);
            if (refreshQueuedRef.current && mountedRef.current) {
                refreshQueuedRef.current = false;
                pollRef.current();
            }
        }
    }, [client, path, timeout, interval, maxInterval, stopOnConnected, pauseWhenHidden, schedule]);

    pollRef.current = poll;

    /** Poll right now. Cancels any in-flight request and pending timer. */
    const refresh = useCallback(() => {
        stoppedRef.current = false;
        setStopped(false);
        clearTimer();
        if (inFlightRef.current) {
            refreshQueuedRef.current = true;
            abortRef.current?.abort();
        } else {
            pollRef.current();
        }
    }, [clearTimer]);

    /** Stop polling until refresh() is called. */
    const stop = useCallback(() => {
        stoppedRef.current = true;
        setStopped(true);
        clearTimer();
        abortRef.current?.abort();
    }, [clearTimer]);

    useEffect(() => {
        mountedRef.current = true;
        if (!enabled) {
            return () => {
                mountedRef.current = false;
            };
        }

        stoppedRef.current = false;
        pausedRef.current = false;
        connectedFiredRef.current = false;
        failuresRef.current = 0;
        setStopped(false);
        pollRef.current();

        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                pausedRef.current = true;
                clearTimer();
                abortRef.current?.abort();
            } else if (pausedRef.current) {
                pausedRef.current = false;
                pollRef.current();
            }
        };
        if (pauseWhenHidden) document.addEventListener('visibilitychange', onVisibility);

        return () => {
            mountedRef.current = false;
            clearTimer();
            abortRef.current?.abort();
            if (pauseWhenHidden) document.removeEventListener('visibilitychange', onVisibility);
        };
        // Intentionally excludes `poll`: identity changes are picked up via pollRef.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, pauseWhenHidden, client, path, interval]);

    return {
        status: snapshot.status,
        data: snapshot.data,
        error: snapshot.error,
        failures: snapshot.failures,
        lastUpdated: snapshot.lastUpdated,
        isConnected: isConnectedStatus(snapshot.status),
        isScanning: isScanStatus(snapshot.status),
        isFailed: isFailedStatus(snapshot.status),
        isPolling,
        isStopped: stopped,
        nextAt,
        refresh,
        stop,
    };
}
