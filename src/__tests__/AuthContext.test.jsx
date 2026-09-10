import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { authApi, TOKEN_KEY, USER_KEY, UNAUTHORIZED_EVENT } from '../services/api';

vi.mock('../services/api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        authApi: { login: vi.fn(), register: vi.fn(), me: vi.fn() },
    };
});

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => vi.clearAllMocks());

describe('AuthContext', () => {
    it('throws a helpful error when useAuth is used outside the provider', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => renderHook(() => useAuth())).toThrow(/inside an <AuthProvider>/);
        spy.mockRestore();
    });

    it('starts unauthenticated when nothing is stored', () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.status).toBe('unauthenticated');
        expect(result.current.isAuthenticated).toBe(false);
        expect(result.current.user).toBeNull();
    });

    it('login() persists the token + user and flips to authenticated', async () => {
        authApi.login.mockResolvedValue({ token: 'jwt.abc', user: { id: '1', name: 'Ada' } });
        const { result } = renderHook(() => useAuth(), { wrapper });

        await act(async () => {
            await result.current.login({ email: 'a@b.c', password: 'pw' });
        });

        expect(result.current.isAuthenticated).toBe(true);
        expect(result.current.user).toEqual({ id: '1', name: 'Ada' });
        expect(window.localStorage.getItem(TOKEN_KEY)).toBe('jwt.abc');
        expect(JSON.parse(window.localStorage.getItem(USER_KEY))).toEqual({ id: '1', name: 'Ada' });
    });

    it('accepts an accessToken-style response', async () => {
        authApi.login.mockResolvedValue({ accessToken: 'jwt.xyz', user: { id: '9' } });
        const { result } = renderHook(() => useAuth(), { wrapper });

        await act(async () => {
            await result.current.login({});
        });

        expect(result.current.token).toBe('jwt.xyz');
    });

    it('login() rejects and stays signed out if the response has no token', async () => {
        authApi.login.mockResolvedValue({ message: 'ok but no token' });
        const { result } = renderHook(() => useAuth(), { wrapper });

        await expect(
            act(async () => {
                await result.current.login({});
            })
        ).rejects.toThrow(/did not include a token/);

        expect(result.current.isAuthenticated).toBe(false);
        expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('logout() clears state and storage', async () => {
        authApi.login.mockResolvedValue({ token: 't', user: { id: '1' } });
        const { result } = renderHook(() => useAuth(), { wrapper });

        await act(async () => {
            await result.current.login({});
        });
        act(() => result.current.logout());

        expect(result.current.status).toBe('unauthenticated');
        expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
        expect(window.localStorage.getItem(USER_KEY)).toBeNull();
    });

    it('ends the session when the API layer broadcasts a 401', async () => {
        authApi.login.mockResolvedValue({ token: 't', user: { id: '1' } });
        const { result } = renderHook(() => useAuth(), { wrapper });

        await act(async () => {
            await result.current.login({});
        });
        expect(result.current.isAuthenticated).toBe(true);

        act(() => {
            window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        });

        expect(result.current.isAuthenticated).toBe(false);
    });

    it('re-validates a stored token via /auth/me on mount', async () => {
        window.localStorage.setItem(TOKEN_KEY, 'stored');
        window.localStorage.setItem(USER_KEY, JSON.stringify({ id: '1', name: 'Old' }));
        authApi.me.mockResolvedValue({ user: { id: '1', name: 'Fresh' } });

        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.status).toBe('loading');

        await act(async () => {});

        expect(result.current.status).toBe('authenticated');
        expect(result.current.user.name).toBe('Fresh');
    });
});
