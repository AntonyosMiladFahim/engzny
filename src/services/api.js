import axios from 'axios';

/**
 * Centralised Axios instance for the whole frontend.
 *
 * - Base URL comes from VITE_API_URL (falls back to the same-origin `/api`,
 *   which matches the Vercel rewrite in vercel.json).
 * - A request interceptor attaches the JWT from localStorage as a Bearer token.
 * - A response interceptor turns a 401 into a global "auth:unauthorized" event
 *   so AuthContext can clear the session without api.js importing React code
 *   (avoids a circular dependency).
 */

export const TOKEN_KEY = 'engzny.token';
export const USER_KEY = 'engzny.user';
export const UNAUTHORIZED_EVENT = 'auth:unauthorized';

const safeStorage = {
    get(key) {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    set(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch {
            /* storage disabled (private mode / quota) – session becomes memory-only */
        }
    },
    remove(key) {
        try {
            window.localStorage.removeItem(key);
        } catch {
            /* ignore */
        }
    },
};

export const tokenStorage = {
    getToken: () => safeStorage.get(TOKEN_KEY),
    setToken: (token) => safeStorage.set(TOKEN_KEY, token),
    getUser: () => {
        const raw = safeStorage.get(USER_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    },
    setUser: (user) => safeStorage.set(USER_KEY, JSON.stringify(user)),
    clear: () => {
        safeStorage.remove(TOKEN_KEY);
        safeStorage.remove(USER_KEY);
    },
};

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
});

// ---- Request interceptor: attach JWT -------------------------------------
api.interceptors.request.use((config) => {
    const token = tokenStorage.getToken();
    if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ---- Response interceptor: broadcast 401s --------------------------------
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error?.response?.status;
        const isAuthRoute = error?.config?.url?.startsWith('/auth/login') ||
            error?.config?.url?.startsWith('/auth/register');

        // A 401 from login itself just means "wrong credentials" – don't nuke
        // an existing session for that. Anything else means the token is dead.
        if (status === 401 && !isAuthRoute) {
            tokenStorage.clear();
            window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        }
        return Promise.reject(normalizeError(error));
    }
);

/** Give callers a predictable `error.message` regardless of backend shape. */
function normalizeError(error) {
    const data = error?.response?.data;
    const serverMessage =
        (typeof data === 'string' && data) ||
        data?.message ||
        data?.error ||
        (Array.isArray(data?.errors) && data.errors.map((e) => e.msg || e.message || e).join(', '));

    if (serverMessage) error.message = serverMessage;
    else if (error?.code === 'ECONNABORTED') error.message = 'Request timed out. Please try again.';
    else if (!error?.response) error.message = 'Network error. Check your connection and try again.';
    return error;
}

// ---- Typed-ish endpoint helpers ------------------------------------------
export const authApi = {
    login: (credentials) => api.post('/auth/login', credentials).then((r) => r.data),
    register: (payload) => api.post('/auth/register', payload).then((r) => r.data),
    me: () => api.get('/auth/me').then((r) => r.data),
};

export default api;
