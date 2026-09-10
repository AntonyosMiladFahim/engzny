import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Layout route: renders child routes only for authenticated users.
 * Unauthenticated visitors are sent to /login and the attempted URL is kept in
 * location.state.from so Login can bounce them back after success.
 */
export default function ProtectedRoute({ redirectTo = '/login' }) {
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();

    if (isLoading) {
        return (
            <div role="status" aria-live="polite" className="p-8 text-center text-gray-500">
                Checking your session…
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to={redirectTo} replace state={{ from: location }} />;
    }

    return <Outlet />;
}
