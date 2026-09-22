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

let endingSession = false;

/**
 * For a 401: this browser's session is over (it expired, or the account signed
 * out of all devices), but its cookie is still here, and the page gate sends
 * anyone carrying one from the sign-in page to the dashboard, which answers 401
 * again: a loop. Signing out removes the cookie, then sign-in shows, with
 * `returnTo` as where to come back to. When several requests fail at once, only
 * the first acts.
 */
export function sessionEnded(returnTo?: string) {
    if (endingSession) return;
    endingSession = true;
    const target = returnTo ? `/login?callbackUrl=${encodeURIComponent(returnTo)}` : '/login';
    signOutAndForget(target).catch(() => {
        window.location.href = target;
    });
}
