import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Layout route for /login and /register: an already-signed-in user has no
 * business here, so bounce them to the dashboard.
 */
export default function PublicOnlyRoute({ redirectTo = '/dashboard' }) {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) return null; // avoid a redirect flicker while validating the token
    if (isAuthenticated) return <Navigate to={redirectTo} replace />;
    return <Outlet />;
}
