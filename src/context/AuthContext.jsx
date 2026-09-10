import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
} from 'react';
import { authApi, tokenStorage, UNAUTHORIZED_EVENT } from '../services/api';

/**
 * Global session state.
 *
 * status:
 *   'loading'          – first render, we are checking localStorage / the server
 *   'authenticated'    – token + user present
 *   'unauthenticated'  – no valid session
 */
export const AuthContext = createContext(null);

const initialState = () => {
    const token = tokenStorage.getToken();
    const user = tokenStorage.getUser();
    return {
        token,
        user,
        // If a token exists we optimistically start as authenticated (so a page
        // refresh does not flash the login screen) but still re-validate below.
        status: token ? 'loading' : 'unauthenticated',
    };
};

function reducer(state, action) {
    switch (action.type) {
        case 'SESSION_SET':
            return { token: action.token, user: action.user, status: 'authenticated' };
        case 'USER_UPDATED':
            return { ...state, user: action.user, status: 'authenticated' };
        case 'SESSION_CLEARED':
            return { token: null, user: null, status: 'unauthenticated' };
        default:
            return state;
    }
}

/** Accepts the common backend shapes: {token,user} | {accessToken,user} | {token, ...userFields}. */
function extractSession(payload) {
    if (!payload) return null;
    const token = payload.token || payload.accessToken || payload.jwt;
    if (!token) return null;
    const user = payload.user ?? stripToken(payload);
    return { token, user };
}

function stripToken(obj) {
    // eslint-disable-next-line no-unused-vars
    const { token, accessToken, jwt, ...rest } = obj;
    return Object.keys(rest).length ? rest : null;
}

export function AuthProvider({ children }) {
    const [state, dispatch] = useReducer(reducer, undefined, initialState);

    const applySession = useCallback((payload) => {
        const session = extractSession(payload);
        if (!session) {
            throw new Error('Authentication response did not include a token.');
        }
        tokenStorage.setToken(session.token);
        if (session.user) tokenStorage.setUser(session.user);
        dispatch({ type: 'SESSION_SET', token: session.token, user: session.user });
        return session;
    }, []);

    const logout = useCallback(() => {
        tokenStorage.clear();
        dispatch({ type: 'SESSION_CLEARED' });
    }, []);

    const login = useCallback(
        async (credentials) => applySession(await authApi.login(credentials)),
        [applySession]
    );

    const register = useCallback(
        async (payload) => applySession(await authApi.register(payload)),
        [applySession]
    );

    // Re-validate a persisted token on first mount.
    useEffect(() => {
        if (state.status !== 'loading') return undefined;

        let cancelled = false;
        (async () => {
            try {
                const me = await authApi.me();
                if (cancelled) return;
                const user = me?.user ?? me;
                tokenStorage.setUser(user);
                dispatch({ type: 'USER_UPDATED', user });
            } catch (err) {
                if (cancelled) return;
                if (err?.response?.status === 401) {
                    // Interceptor already cleared storage; mirror it in state.
                    dispatch({ type: 'SESSION_CLEARED' });
                } else {
                    // /auth/me unavailable (offline, 404, 5xx). Keep the cached
                    // session rather than logging the user out on a hiccup.
                    dispatch({ type: 'USER_UPDATED', user: state.user });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
        // Only run for the initial 'loading' status.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Any 401 anywhere in the app (raised by the Axios interceptor) ends the session.
    useEffect(() => {
        const onUnauthorized = () => dispatch({ type: 'SESSION_CLEARED' });
        window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
        return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    }, []);

    // Keep tabs in sync: logging out in one tab logs out the others.
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === null || e.key === 'engzny.token') {
                const token = tokenStorage.getToken();
                if (!token) dispatch({ type: 'SESSION_CLEARED' });
                else dispatch({ type: 'SESSION_SET', token, user: tokenStorage.getUser() });
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const value = useMemo(
        () => ({
            user: state.user,
            token: state.token,
            status: state.status,
            isAuthenticated: state.status === 'authenticated',
            isLoading: state.status === 'loading',
            login,
            register,
            logout,
        }),
        [state, login, register, logout]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used inside an <AuthProvider>.');
    }
    return ctx;
}
