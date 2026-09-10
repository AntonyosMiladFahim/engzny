import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { AppRoutes } from '../App';
import { TOKEN_KEY, USER_KEY } from '../services/api';

/** Mount the real route table at a given URL, wrapped in the real AuthProvider. */
export function renderApp(initialPath = '/') {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <AuthProvider>
                <AppRoutes />
            </AuthProvider>
        </MemoryRouter>
    );
}

/** Seed localStorage as if a user had already logged in. */
export function seedSession(user = { id: 'u1', name: 'Ada', email: 'ada@example.com' }, token = 'seeded.jwt.token') {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    return { user, token };
}
