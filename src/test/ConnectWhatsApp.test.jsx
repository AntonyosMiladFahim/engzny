import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { authApi } from '../services/api';
import { AuthProvider } from '../context/AuthContext';
import ConnectWhatsApp, { LOCK_MS } from '../pages/ConnectWhatsApp';
import { SWEEP_MS } from '../components/connect/SweepOverlay';
import { seedSession } from './utils';

vi.mock('../services/api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        default: { get: vi.fn(), post: vi.fn() },
        authApi: { login: vi.fn(), register: vi.fn(), me: vi.fn() },
    };
});

const flush = () => act(async () => {
    await vi.advanceTimersByTimeAsync(0);
});
const advance = (ms) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
});

const QR = 'data:image/png;base64,iVBORw0KGgo=';

function mockBackend({ statuses = ['SCAN_QR_CODE'], qrInStatus = false, qrEndpoint = { data: { qr: QR }, headers: { 'content-type': 'application/json' } } } = {}) {
    let i = 0;
    const statusCalls = [];
    api.get.mockImplementation((url, config) => {
        if (url === '/waha/status') {
            statusCalls.push(config);
            const status = statuses[Math.min(i++, statuses.length - 1)];
            if (status instanceof Error) return Promise.reject(status);
            return Promise.resolve({ data: qrInStatus ? { status, qr: QR } : { status } });
        }
        if (url === '/waha/qr') {
            return qrEndpoint instanceof Error ? Promise.reject(qrEndpoint) : Promise.resolve(qrEndpoint);
        }
        return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    return { statusCalls };
}

function renderConnect() {
    const { user } = seedSession();
    authApi.me.mockResolvedValue({ user });
    return render(
        <MemoryRouter initialEntries={['/connect']}>
            <AuthProvider>
                <Routes>
                    <Route path="/connect" element={<ConnectWhatsApp />} />
                    <Route path="/dashboard" element={<h1>Dashboard stub</h1>} />
                </Routes>
            </AuthProvider>
        </MemoryRouter>
    );
}

const scanner = () => document.querySelector('[data-mode]');

describe('ConnectWhatsApp', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows the scanner with the QR code fetched from /waha/qr while the session awaits a scan', async () => {
        mockBackend();
        renderConnect();

        expect(screen.getByRole('heading', { name: /connect whatsapp/i })).toBeInTheDocument();
        expect(scanner()).toHaveAttribute('data-mode', 'loading');

        await flush();
        expect(scanner()).toHaveAttribute('data-mode', 'scan');
        const img = screen.getByAltText(/pairing qr code/i);
        expect(img).toHaveAttribute('src', QR);
        expect(api.get).toHaveBeenCalledWith('/waha/qr', expect.objectContaining({ responseType: 'blob' }));
        expect(screen.getByText(/awaiting scan/i)).toBeInTheDocument();
    });

    it('uses the QR embedded in the status payload without hitting /waha/qr', async () => {
        mockBackend({ qrInStatus: true });
        renderConnect();
        await flush();

        expect(screen.getByAltText(/pairing qr code/i)).toHaveAttribute('src', QR);
        expect(api.get.mock.calls.some(([url]) => url === '/waha/qr')).toBe(false);
    });

    it('locks, sweeps and lands on the dashboard the moment polling reports CONNECTED', async () => {
        const { statusCalls } = mockBackend({ statuses: ['SCAN_QR_CODE', 'SCAN_QR_CODE', 'CONNECTED'] });
        renderConnect();

        await flush(); // poll #1
        await advance(3000); // poll #2
        expect(scanner()).toHaveAttribute('data-mode', 'scan');
        expect(screen.queryByTestId('sweep-overlay')).not.toBeInTheDocument();

        await advance(3000); // poll #3 → CONNECTED
        expect(statusCalls).toHaveLength(3);
        expect(scanner()).toHaveAttribute('data-mode', 'linked');
        expect(screen.getByText(/^linked$/i)).toBeInTheDocument();

        await advance(LOCK_MS);
        expect(screen.getByTestId('sweep-overlay')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /dashboard stub/i })).not.toBeInTheDocument();

        await advance(SWEEP_MS);
        expect(screen.getByRole('heading', { name: /dashboard stub/i })).toBeInTheDocument();

        // Polling stopped at CONNECTED; nothing else fires after navigation.
        await advance(10000);
        expect(statusCalls).toHaveLength(3);
    });

    it('renders the offline state with a countdown when the status endpoint is unreachable, then recovers', async () => {
        const boom = Object.assign(new Error('Network error. Check your connection and try again.'), { code: 'ERR_NETWORK' });
        mockBackend({ statuses: [boom, 'SCAN_QR_CODE'] });
        renderConnect();

        await flush();
        expect(scanner()).toHaveAttribute('data-mode', 'offline');
        expect(screen.getByText(/can.t reach the server/i)).toBeInTheDocument();
        expect(screen.getByText(/network error/i)).toBeInTheDocument();
        expect(screen.getByText(/retrying in 3s/i)).toBeInTheDocument();

        await advance(1000);
        expect(screen.getByText(/retrying in 2s/i)).toBeInTheDocument();

        await advance(2000); // retry → SCAN_QR_CODE
        expect(scanner()).toHaveAttribute('data-mode', 'scan');
    });

    it('"Retry now" polls immediately instead of waiting for the backoff timer', async () => {
        const boom = new Error('offline');
        const { statusCalls } = mockBackend({ statuses: [boom, 'SCAN_QR_CODE'] });
        renderConnect();
        await flush();
        expect(statusCalls).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: /retry now/i }));
        await flush();
        expect(statusCalls).toHaveLength(2);
        expect(scanner()).toHaveAttribute('data-mode', 'scan');
    });

    it('raises a frosted toast (not an alert) after three consecutive polling failures', async () => {
        const alertSpy = vi.spyOn(window, 'alert');
        const boom = new Error('offline');
        mockBackend({ statuses: [boom, boom, boom, boom] });
        renderConnect();

        await flush(); // fail 1 → +3000
        await advance(3000); // fail 2 → +4500
        expect(screen.queryByText(/still trying to reach the server/i)).not.toBeInTheDocument();
        await advance(4500); // fail 3 → toast
        expect(screen.getByText(/still trying to reach the server/i)).toBeInTheDocument();
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('shows the failed-session state with a "New code" action when WAHA reports FAILED', async () => {
        mockBackend({ statuses: ['FAILED'] });
        renderConnect();
        await flush();
        expect(scanner()).toHaveAttribute('data-mode', 'failed');
        expect(screen.getByRole('button', { name: /new code/i })).toBeInTheDocument();
    });

    it('toasts when the QR endpoint fails but keeps polling for status', async () => {
        const { statusCalls } = mockBackend({ qrEndpoint: new Error('QR service down') });
        renderConnect();
        await flush();

        expect(screen.getByText(/pairing code unavailable/i)).toBeInTheDocument();
        expect(screen.getByText(/generating pairing code/i)).toBeInTheDocument();
        await advance(3000);
        expect(statusCalls).toHaveLength(2);
    });

    it('offers an escape hatch to the dashboard without linking', async () => {
        mockBackend();
        renderConnect();
        await flush();
        expect(screen.getByRole('link', { name: /continue without linking/i })).toHaveAttribute('href', '/dashboard');
    });
});
