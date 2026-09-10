import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useWahaPolling, { normalizeStatus } from '../hooks/useWahaPolling';

const ok = (status, extra = {}) => ({ data: { status, ...extra } });
const flush = () => act(async () => {
    await vi.advanceTimersByTimeAsync(0);
});
const advance = (ms) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
});

function makeClient(impl) {
    return { get: vi.fn(impl) };
}

describe('normalizeStatus', () => {
    it('reads common payload shapes and upper-cases', () => {
        expect(normalizeStatus('working')).toBe('WORKING');
        expect(normalizeStatus({ status: 'scan_qr_code' })).toBe('SCAN_QR_CODE');
        expect(normalizeStatus({ state: 'Connected' })).toBe('CONNECTED');
        expect(normalizeStatus({ data: { status: 'STARTING' } })).toBe('STARTING');
        expect(normalizeStatus(null)).toBeNull();
        expect(normalizeStatus({})).toBeNull();
    });
});

describe('useWahaPolling', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('polls immediately on mount, then every 3 seconds', async () => {
        const client = makeClient(() => Promise.resolve(ok('SCAN_QR_CODE')));
        const { result } = renderHook(() => useWahaPolling({ client }));

        await flush();
        expect(client.get).toHaveBeenCalledTimes(1);
        expect(client.get).toHaveBeenCalledWith('/waha/status', expect.objectContaining({ timeout: 8000, signal: expect.any(AbortSignal) }));
        expect(result.current.status).toBe('SCAN_QR_CODE');
        expect(result.current.isScanning).toBe(true);
        expect(result.current.isConnected).toBe(false);

        await advance(2999);
        expect(client.get).toHaveBeenCalledTimes(1);
        await advance(1);
        expect(client.get).toHaveBeenCalledTimes(2);
        await advance(3000);
        expect(client.get).toHaveBeenCalledTimes(3);
    });

    it('never overlaps requests: waits for a slow response before scheduling the next tick', async () => {
        let resolveFirst;
        const client = makeClient(
            () =>
                new Promise((res) => {
                    resolveFirst = res;
                })
        );
        const { result } = renderHook(() => useWahaPolling({ client }));

        await flush();
        expect(result.current.isPolling).toBe(true);
        await advance(9000);
        expect(client.get).toHaveBeenCalledTimes(1);

        client.get.mockImplementation(() => Promise.resolve(ok('SCAN_QR_CODE')));
        await act(async () => {
            resolveFirst(ok('STARTING'));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current.status).toBe('STARTING');
        expect(result.current.isPolling).toBe(false);

        await advance(3000);
        expect(client.get).toHaveBeenCalledTimes(2);
    });

    it('fires onConnected exactly once and stops polling when CONNECTED arrives', async () => {
        const sequence = ['SCAN_QR_CODE', 'CONNECTED', 'CONNECTED'];
        let i = 0;
        const client = makeClient(() => Promise.resolve(ok(sequence[Math.min(i++, sequence.length - 1)], { me: '+20100' })));
        const onConnected = vi.fn();
        const onStatusChange = vi.fn();
        const { result } = renderHook(() => useWahaPolling({ client, onConnected, onStatusChange }));

        await flush();
        expect(onConnected).not.toHaveBeenCalled();

        await advance(3000);
        expect(result.current.isConnected).toBe(true);
        expect(result.current.isStopped).toBe(true);
        expect(onConnected).toHaveBeenCalledTimes(1);
        expect(onConnected).toHaveBeenCalledWith({ status: 'CONNECTED', me: '+20100' });

        await advance(30000);
        expect(client.get).toHaveBeenCalledTimes(2);
        expect(onConnected).toHaveBeenCalledTimes(1);
        expect(onStatusChange.mock.calls.map((c) => c[0])).toEqual(['SCAN_QR_CODE', 'CONNECTED']);
    });

    it('treats WORKING (WAHA vocabulary) as connected', async () => {
        const client = makeClient(() => Promise.resolve(ok('WORKING')));
        const onConnected = vi.fn();
        renderHook(() => useWahaPolling({ client, onConnected }));
        await flush();
        expect(onConnected).toHaveBeenCalledTimes(1);
    });

    it('keeps polling after connection when stopOnConnected is false', async () => {
        const client = makeClient(() => Promise.resolve(ok('CONNECTED')));
        renderHook(() => useWahaPolling({ client, stopOnConnected: false, interval: 1000 }));
        await flush();
        await advance(3000);
        expect(client.get).toHaveBeenCalledTimes(4);
    });

    it('backs off on consecutive failures (×1.5, capped) and exposes error/failures/nextAt', async () => {
        const client = makeClient(() => Promise.reject(new Error('Network error')));
        const onError = vi.fn();
        const { result } = renderHook(() => useWahaPolling({ client, onError, maxInterval: 6000 }));

        await flush();
        expect(result.current.error?.message).toBe('Network error');
        expect(result.current.failures).toBe(1);
        expect(result.current.nextAt - Date.now()).toBe(3000);
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);

        await advance(3000); // 2nd attempt → fails → delay 4500
        expect(client.get).toHaveBeenCalledTimes(2);
        expect(result.current.failures).toBe(2);
        expect(result.current.nextAt - Date.now()).toBe(4500);

        await advance(4499);
        expect(client.get).toHaveBeenCalledTimes(2);
        await advance(1); // 3rd attempt → fails → delay min(6750, 6000)
        expect(client.get).toHaveBeenCalledTimes(3);
        expect(result.current.nextAt - Date.now()).toBe(6000);

        // Recovery resets the backoff.
        client.get.mockImplementation(() => Promise.resolve(ok('SCAN_QR_CODE')));
        await advance(6000);
        expect(result.current.error).toBeNull();
        expect(result.current.failures).toBe(0);
        expect(result.current.nextAt - Date.now()).toBe(3000);
    });

    it('surfaces timeouts as errors and keeps going', async () => {
        const timeoutErr = Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' });
        let n = 0;
        const client = makeClient(() => (n++ === 0 ? Promise.reject(timeoutErr) : Promise.resolve(ok('SCAN_QR_CODE'))));
        const { result } = renderHook(() => useWahaPolling({ client }));

        await flush();
        expect(result.current.error?.code).toBe('ECONNABORTED');
        await advance(3000);
        expect(result.current.error).toBeNull();
        expect(result.current.status).toBe('SCAN_QR_CODE');
    });

    it('refresh() polls immediately and cancels the pending timer', async () => {
        const client = makeClient(() => Promise.resolve(ok('SCAN_QR_CODE')));
        const { result } = renderHook(() => useWahaPolling({ client }));

        await flush();
        await advance(1000);
        act(() => result.current.refresh());
        await flush();
        expect(client.get).toHaveBeenCalledTimes(2);

        // The old tick (due at t=3000) must not fire; the new one lands at t=1000+3000.
        await advance(2000);
        expect(client.get).toHaveBeenCalledTimes(2);
        await advance(1000);
        expect(client.get).toHaveBeenCalledTimes(3);
    });

    it('refresh() during an in-flight request aborts it and re-polls', async () => {
        let n = 0;
        const client = makeClient(() => (n++ === 0 ? new Promise(() => {}) : Promise.resolve(ok('SCAN_QR_CODE'))));
        const { result } = renderHook(() => useWahaPolling({ client }));

        await flush();
        const firstSignal = client.get.mock.calls[0][1].signal;
        act(() => result.current.refresh());
        await flush();

        expect(firstSignal.aborted).toBe(true);
        expect(client.get).toHaveBeenCalledTimes(1); // second poll waits for the abort to settle…
        // …the never-resolving promise never settles, so the queued refresh is a no-op here;
        // a real axios request rejects on abort, which the hook handles (see next test).
    });

    it('a request that rejects on abort does not count as a failure', async () => {
        const client = makeClient(
            (_, { signal }) =>
                new Promise((_res, rej) => {
                    signal.addEventListener('abort', () => rej(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })));
                })
        );
        const { result, unmount } = renderHook(() => useWahaPolling({ client }));
        await flush();
        unmount();
        await flush();
        expect(client.get.mock.calls[0][1].signal.aborted).toBe(true);
        expect(result.current.failures).toBe(0);
        expect(result.current.error).toBeNull();
    });

    it('stops all timers and aborts on unmount', async () => {
        const client = makeClient(() => Promise.resolve(ok('SCAN_QR_CODE')));
        const { unmount } = renderHook(() => useWahaPolling({ client }));
        await flush();
        unmount();
        await advance(30000);
        expect(client.get).toHaveBeenCalledTimes(1);
    });

    it('pauses while the document is hidden and resumes immediately when visible', async () => {
        const client = makeClient(() => Promise.resolve(ok('SCAN_QR_CODE')));
        renderHook(() => useWahaPolling({ client }));
        await flush();
        expect(client.get).toHaveBeenCalledTimes(1);

        const setVisibility = (v) =>
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });

        setVisibility('hidden');
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await advance(20000);
        expect(client.get).toHaveBeenCalledTimes(1);

        setVisibility('visible');
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await flush();
        expect(client.get).toHaveBeenCalledTimes(2);
        await advance(3000);
        expect(client.get).toHaveBeenCalledTimes(3);

        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    it('does nothing while disabled', async () => {
        const client = makeClient(() => Promise.resolve(ok('SCAN_QR_CODE')));
        renderHook(() => useWahaPolling({ client, enabled: false }));
        await advance(10000);
        expect(client.get).not.toHaveBeenCalled();
    });
});
