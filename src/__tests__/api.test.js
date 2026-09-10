import { describe, it, expect, vi, beforeEach } from 'vitest';
import api, { authApi, tokenStorage, TOKEN_KEY, USER_KEY, UNAUTHORIZED_EVENT } from '../services/api';

/** Replace the network layer so we can inspect the final request config. */
function useAdapter(impl) {
    const adapter = vi.fn(impl);
    api.defaults.adapter = adapter;
    return adapter;
}

const okAdapter = (config) =>
    Promise.resolve({ data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config });

const rejectWith = (status) => (config) => {
    const err = new Error(`Request failed with status code ${status}`);
    err.config = config;
    err.response = { status, data: { message: `HTTP ${status}` }, headers: {}, config };
    return Promise.reject(err);
};

beforeEach(() => {
    window.localStorage.clear();
});

describe('api request interceptor', () => {
    it('attaches Authorization: Bearer <jwt> when a token is stored', async () => {
        tokenStorage.setToken('my.jwt.token');
        const adapter = useAdapter(okAdapter);

        await api.get('/folders');

        const sent = adapter.mock.calls[0][0];
        expect(sent.headers.Authorization).toBe('Bearer my.jwt.token');
    });

    it('sends no Authorization header when no token is stored', async () => {
        const adapter = useAdapter(okAdapter);

        await api.get('/folders');

        const sent = adapter.mock.calls[0][0];
        expect(sent.headers.Authorization).toBeUndefined();
    });

    it('reads the token at request time, not at module load', async () => {
        const adapter = useAdapter(okAdapter);
        await api.get('/a');
        tokenStorage.setToken('late.token');
        await api.get('/b');

        expect(adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
        expect(adapter.mock.calls[1][0].headers.Authorization).toBe('Bearer late.token');
    });

    it('uses /api as the default base URL', () => {
        expect(api.defaults.baseURL).toBe('/api');
    });
});

describe('api response interceptor', () => {
    it('on 401 from a protected endpoint: clears storage and dispatches auth:unauthorized', async () => {
        tokenStorage.setToken('stale');
        tokenStorage.setUser({ id: 1 });
        const listener = vi.fn();
        window.addEventListener(UNAUTHORIZED_EVENT, listener);
        useAdapter(rejectWith(401));

        await expect(api.get('/folders')).rejects.toThrow('HTTP 401');

        expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
        expect(window.localStorage.getItem(USER_KEY)).toBeNull();
        expect(listener).toHaveBeenCalledTimes(1);
        window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    });

    it('on 401 from /auth/login (bad credentials): does NOT clear an existing session', async () => {
        tokenStorage.setToken('still-valid');
        const listener = vi.fn();
        window.addEventListener(UNAUTHORIZED_EVENT, listener);
        useAdapter(rejectWith(401));

        await expect(authApi.login({ email: 'x', password: 'y' })).rejects.toThrow('HTTP 401');

        expect(window.localStorage.getItem(TOKEN_KEY)).toBe('still-valid');
        expect(listener).not.toHaveBeenCalled();
        window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    });

    it('surfaces the server-provided message as error.message', async () => {
        useAdapter((config) => {
            const err = new Error('Request failed with status code 400');
            err.config = config;
            err.response = { status: 400, data: { error: 'Email already in use' }, headers: {}, config };
            return Promise.reject(err);
        });

        await expect(authApi.register({})).rejects.toThrow('Email already in use');
    });

    it('gives a friendly message for network failures', async () => {
        useAdapter((config) => {
            const err = new Error('Network Error');
            err.config = config;
            err.code = 'ERR_NETWORK';
            return Promise.reject(err);
        });

        await expect(api.get('/x')).rejects.toThrow(/network error/i);
    });
});

describe('authApi helpers', () => {
    it('login posts to /auth/login and unwraps data', async () => {
        const adapter = useAdapter((config) =>
            Promise.resolve({ data: { token: 't', user: { id: 1 } }, status: 200, headers: {}, config })
        );

        const result = await authApi.login({ email: 'a', password: 'b' });

        const sent = adapter.mock.calls[0][0];
        expect(sent.method).toBe('post');
        expect(sent.url).toBe('/auth/login');
        expect(JSON.parse(sent.data)).toEqual({ email: 'a', password: 'b' });
        expect(result).toEqual({ token: 't', user: { id: 1 } });
    });

    it('me gets /auth/me', async () => {
        const adapter = useAdapter(okAdapter);
        await authApi.me();
        expect(adapter.mock.calls[0][0].url).toBe('/auth/me');
        expect(adapter.mock.calls[0][0].method).toBe('get');
    });
});
