import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderApp, seedSession } from '../test/utils';
import { authApi, TOKEN_KEY } from '../services/api';

vi.mock('../services/api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        authApi: { login: vi.fn(), register: vi.fn(), me: vi.fn() },
    };
});

const unauthorized = () => Object.assign(new Error('Unauthorized'), { response: { status: 401 } });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('route protection', () => {
    it('redirects an anonymous visitor from /dashboard to /login', async () => {
        renderApp('/dashboard');

        expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
        expect(authApi.me).not.toHaveBeenCalled();
    });

    it('redirects an anonymous visitor from any protected route (e.g. /connect)', async () => {
        renderApp('/connect');
        expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    it('redirects "/" to the dashboard, which then falls through to login when signed out', async () => {
        renderApp('/');
        expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    it('shows a loading state while a stored token is being validated', () => {
        seedSession();
        authApi.me.mockReturnValue(new Promise(() => {})); // never resolves

        renderApp('/dashboard');

        expect(screen.getByRole('status')).toHaveTextContent(/checking your session/i);
        expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument();
    });

    it('renders the dashboard for a visitor with a valid stored session', async () => {
        const { user } = seedSession();
        authApi.me.mockResolvedValue({ user });

        renderApp('/dashboard');

        expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        expect(screen.getByText(/welcome, ada/i)).toBeInTheDocument();
        expect(authApi.me).toHaveBeenCalledTimes(1);
    });

    it('keeps the cached session when /auth/me is unreachable (non-401 error)', async () => {
        seedSession();
        authApi.me.mockRejectedValue(Object.assign(new Error('Network error'), { response: undefined }));

        renderApp('/dashboard');

        expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        expect(window.localStorage.getItem(TOKEN_KEY)).toBe('seeded.jwt.token');
    });

    it('kicks the user to /login when the stored token is rejected with 401', async () => {
        seedSession();
        authApi.me.mockRejectedValue(unauthorized());

        renderApp('/dashboard');

        expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
    });

    it('sends an already-authenticated user away from /login to /dashboard', async () => {
        const { user } = seedSession();
        authApi.me.mockResolvedValue({ user });

        renderApp('/login');

        expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    });

    it('renders a 404 for unknown paths without requiring auth', async () => {
        renderApp('/nope');
        expect(await screen.findByRole('heading', { name: /404/i })).toBeInTheDocument();
    });
});

describe('login flow', () => {
    it('logs in and returns the user to the page they originally requested', async () => {
        const user = userEvent.setup();
        authApi.login.mockResolvedValue({
            token: 'fresh.jwt',
            user: { id: 'u2', name: 'Grace', email: 'grace@example.com' },
        });

        renderApp('/connect'); // protected → bounced to /login with state.from
        await screen.findByRole('heading', { name: /sign in/i });

        await user.type(screen.getByLabelText(/email/i), 'grace@example.com');
        await user.type(screen.getByLabelText(/password/i), 'hunter22');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        expect(await screen.findByRole('heading', { name: /connect whatsapp/i })).toBeInTheDocument();
        expect(authApi.login).toHaveBeenCalledWith({ email: 'grace@example.com', password: 'hunter22' });
        expect(window.localStorage.getItem(TOKEN_KEY)).toBe('fresh.jwt');
    });

    it('shows the server error and stays on /login when credentials are wrong', async () => {
        const user = userEvent.setup();
        authApi.login.mockRejectedValue(new Error('Invalid email or password'));

        renderApp('/login');

        await user.type(screen.getByLabelText(/email/i), 'x@example.com');
        await user.type(screen.getByLabelText(/password/i), 'wrong');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email or password/i);
        expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
        expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('logging out from the dashboard returns to /login and clears storage', async () => {
        const user = userEvent.setup();
        const { user: me } = seedSession();
        authApi.me.mockResolvedValue({ user: me });

        renderApp('/dashboard');
        await screen.findByRole('heading', { name: /dashboard/i });

        await user.click(screen.getByRole('button', { name: /log out/i }));

        expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
        await waitFor(() => expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull());
    });
});
