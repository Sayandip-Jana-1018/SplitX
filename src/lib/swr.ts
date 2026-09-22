'use client';

import { mutate } from 'swr';
import { NetworkTaggedError, toNetworkTaggedError } from '@/lib/networkErrors';
import { sessionEnded } from '@/lib/signOut';

/**
 * Shared SWR fetcher: tags network failures so screens can render the right
 * error copy, and signs out to /login when the session has ended.
 */
export async function fetcher<T = unknown>(url: string): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, { credentials: 'same-origin' });
    } catch (error) {
        throw toNetworkTaggedError({ error });
    }

    if (response.status === 401) {
        if (typeof window !== 'undefined') sessionEnded();
        throw new NetworkTaggedError('default', 'Your session has expired.');
    }

    if (!response.ok) throw toNetworkTaggedError({ response });
    return response.json() as Promise<T>;
}

const MONEY_KEY_PREFIXES = [
    '/api/groups',
    '/api/transactions',
    '/api/settlements',
    '/api/analytics',
    '/api/search',
];

/**
 * Revalidate every cached money-related query. Call after any write
 * (new expense, edit, delete, settlement) so balances never go stale.
 */
export function refreshMoneyData() {
    return mutate(
        (key) => typeof key === 'string' && MONEY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
        undefined,
        { revalidate: true }
    );
}
