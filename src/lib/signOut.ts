'use client';

import { signOut } from 'next-auth/react';

/**
 * Signs out and removes what this browser kept of the account.
 *
 * The service worker (public/sw.js) keeps only its offline page, but a worker
 * from some other build may have left copies of pages and API responses, and
 * on a shared phone the next person could open them. Everything except the
 * offline page goes.
 */
export async function signOutAndForget(callbackUrl = '/login') {
    try {
        if (typeof caches !== 'undefined') {
            const names = await caches.keys();
            await Promise.all(names.filter((name) => name !== 'splitx-offline-v1').map((name) => caches.delete(name)));
        }
    } catch {
        // A browser without Cache Storage (or with it blocked) has nothing to clear.
    }
    await signOut({ callbackUrl });
}
