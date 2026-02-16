'use client';

import { useState, useEffect } from 'react';

interface CurrentUser {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    phone: string | null;
    upiId: string | null;
    createdAt: string;
}

// Module-level cache so the user is fetched only once per session
let cachedUser: CurrentUser | null = null;
let fetchPromise: Promise<CurrentUser | null> | null = null;

async function fetchUser(): Promise<CurrentUser | null> {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Hook to get the current authenticated user.
 * Caches the result in-memory so it's only fetched once per page session.
 */
export function useCurrentUser() {
    const [user, setUser] = useState<CurrentUser | null>(cachedUser);
    const [loading, setLoading] = useState(!cachedUser);

    useEffect(() => {
        if (cachedUser) {
            setUser(cachedUser);
            setLoading(false);
            return;
        }

        if (!fetchPromise) {
            fetchPromise = fetchUser();
        }

        fetchPromise.then((u) => {
            cachedUser = u;
            setUser(u);
            setLoading(false);
        });
    }, []);

    const refresh = async () => {
        setLoading(true);
        cachedUser = null;
        fetchPromise = null;
        const u = await fetchUser();
        cachedUser = u;
        fetchPromise = null;
        setUser(u);
        setLoading(false);
    };

    return { user, loading, refresh };
}
