/**
 * The notifications list behind the bell: the server's newest 50 and how many are unread, kept
 * once for the whole app, so the bell on every screen and the list agree. Asked for when a main
 * screen comes into view and when a push arrives; offline, what was last known stays.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';
import type { AppNotification } from '@/lib/contract/v1';
import { api } from '~/api';

interface Inbox {
    notifications: AppNotification[] | null;
    unread: number;
}

let inbox: Inbox = { notifications: null, unread: 0 };
const listeners = new Set<() => void>();
const set = (next: Inbox) => {
    inbox = next;
    listeners.forEach((listener) => listener());
};
let asking: Promise<void> | null = null;

/** Brings the list up to date; one request at a time, however many screens ask. */
export function refreshInbox(): Promise<void> {
    asking ??= api
        .notifications()
        .then(({ notifications, unread }) => set({ notifications, unread }))
        .catch(() => undefined)
        .finally(() => {
            asking = null;
        });
    return asking;
}

/** Marks these read here at once, and on the server (all of them without ids). */
export function markRead(ids?: string[]) {
    if (!inbox.notifications) return;
    const all = !ids;
    const marked = new Set(ids);
    const notifications = inbox.notifications.map((n) => (all || marked.has(n.id) ? { ...n, read: true } : n));
    set({ notifications, unread: notifications.filter((n) => !n.read).length });
    void api.markRead(all ? { all: true } : { ids }).catch(() => undefined);
}

/** Forgets the list (signing out). */
export function clearInbox() {
    set({ notifications: null, unread: 0 });
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export function useInbox(): Inbox {
    return useSyncExternalStore(subscribe, () => inbox, () => inbox);
}

/** The unread count for the bell, brought up to date each time its screen comes into view. */
export function useUnread(enabled: boolean): number {
    useFocusEffect(
        useCallback(() => {
            if (enabled) void refreshInbox();
        }, [enabled]),
    );
    return useInbox().unread;
}
