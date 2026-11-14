/**
 * The ledger for the whole app: adding an expense or a payment updates every screen at once.
 *
 * - **Demo:** made-up people and money, kept on the phone, so what you add is still there when the
 *   app opens again; anything unreadable in storage is set aside for the made-up data.
 * - **Signed in:** your groups as the server last sent them (account.ts), kept on the phone per
 *   account so the app opens straight onto them, offline too. They're brought up to date when the
 *   app opens, when it comes back to the front, every minute while it's open, and on a pull-down.
 *   Signing out forgets them on this phone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { SyncGroup } from '@/lib/contract/v1';
import { api } from '~/api';
import { useAuth } from '~/auth/AuthProvider';
import { accountLedger, mergeSync, versionsOf } from './account';
import { makeExpense, personIn, PEOPLE, seedLedger, ME, type Expense, type ExpenseInput, type Ledger, type Message, type Person, type Settlement } from './ledger';

export type NewExpense = Omit<ExpenseInput, 'id' | 'createdAt'>;

/** Where a signed-in ledger stands with the server. */
export type SyncState = 'idle' | 'syncing' | 'offline';

interface LedgerContext {
    ledger: Ledger;
    /** Someone in this ledger, by id. */
    personOf: (id: string) => Person;
    /** True for your real groups; false in the demo. */
    real: boolean;
    sync: SyncState;
    /** Brings your groups up to date now; nothing in the demo. */
    refresh: () => Promise<void>;
    /** For a screen's pull-down: only your real groups have anywhere to refresh from. */
    onRefresh: (() => Promise<void>) | undefined;
    addExpense: (input: NewExpense) => Expense;
    recordPayment: (input: { groupId: string; fromId: string; toId: string; amount: number; method: string }) => Settlement;
    deleteExpense: (id: string) => void;
    setReceipt: (id: string, uri: string | null) => void;
    sendMessage: (groupId: string, text: string) => void;
    /** Back to the made-up starting data. */
    resetLedger: () => void;
}

const SAVED = 'splitit.ledger.v1';
const ACCOUNT = (userId: string) => `splitit.account.v1.${userId}`;
const EVERY_MS = 60_000;
const EMPTY: Ledger = { people: [], groups: [], expenses: [], settlements: [], messages: [] };

/** The saved demo ledger, with its dates turned back into dates; null if it can't be read. */
function revive(text: string): Ledger | null {
    try {
        const raw = JSON.parse(text);
        if (!raw || !Array.isArray(raw.groups) || !Array.isArray(raw.expenses) || !Array.isArray(raw.settlements)) return null;
        const date = (value: unknown) => {
            const parsed = new Date(String(value));
            return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
        };
        return {
            people: Array.isArray(raw.people) ? raw.people : PEOPLE,
            groups: raw.groups,
            expenses: raw.expenses.map((expense: Expense) => ({ ...expense, createdAt: date(expense.createdAt) })),
            settlements: raw.settlements.map((settlement: Settlement) => ({ ...settlement, createdAt: date(settlement.createdAt) })),
            messages: Array.isArray(raw.messages) ? raw.messages.map((message: Message) => ({ ...message, at: date(message.at) })) : [],
        };
    } catch {
        return null;
    }
}

/** The saved account groups; whatever doesn't read as the contract says is dropped and comes again with the next sync. */
function reviveAccount(text: string | null): SyncGroup[] {
    try {
        const raw: unknown = text ? JSON.parse(text) : null;
        if (!Array.isArray(raw)) return [];
        return raw.flatMap((group) => {
            const parsed = SyncGroup.safeParse(group);
            return parsed.success ? [parsed.data] : [];
        });
    } catch {
        return [];
    }
}

const Context = createContext<LedgerContext | null>(null);
let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;

/** Thrown by a change to your real groups until saving them arrives (Phase 2 step 5b). */
class NotYet extends Error {
    constructor() {
        super('Changing your real groups arrives in the next update. For now, use the website.');
    }
}

export function LedgerProvider({ children }: { children: ReactNode }) {
    const auth = useAuth();
    const userId = auth.status === 'signed_in' ? (auth.me?.id ?? null) : null;

    // ── The demo ──
    const [demo, setDemo] = useState<Ledger>(seedLedger);
    const [demoLoaded, setDemoLoaded] = useState(false);

    useEffect(() => {
        AsyncStorage.getItem(SAVED)
            .then((text) => {
                const saved = text ? revive(text) : null;
                if (saved) setDemo(saved);
            })
            .catch(() => undefined)
            .finally(() => setDemoLoaded(true));
    }, []);

    // Saved a moment after each change, once what was saved before has been read.
    useEffect(() => {
        if (!demoLoaded) return;
        const timer = setTimeout(() => {
            AsyncStorage.setItem(SAVED, JSON.stringify(demo)).catch(() => undefined);
        }, 400);
        return () => clearTimeout(timer);
    }, [demo, demoLoaded]);

    // ── Your real groups ──
    const [account, setAccount] = useState<{ userId: string; groups: SyncGroup[] } | null>(null);
    const [sync, setSync] = useState<SyncState>('idle');
    const kept = useRef<{ userId: string; groups: SyncGroup[] } | null>(null);
    const running = useRef<Promise<void> | null>(null);
    const mine = account && account.userId === userId ? account : null;

    const keep = useCallback((next: { userId: string; groups: SyncGroup[] }) => {
        kept.current = next;
        setAccount(next);
        AsyncStorage.setItem(ACCOUNT(next.userId), JSON.stringify(next.groups)).catch(() => undefined);
    }, []);

    const refresh = useCallback(async () => {
        if (!userId) return;
        running.current ??= (async () => {
            setSync('syncing');
            try {
                const before = kept.current?.userId === userId ? kept.current.groups : [];
                const answer = await api.sync(versionsOf(before));
                // Signed out (or someone else signed in) while it ran: what came back isn't theirs.
                if (kept.current && kept.current.userId !== userId) return;
                keep({ userId, groups: mergeSync(before, answer) });
                setSync('idle');
            } catch {
                // Offline or the server is having trouble: what's on the phone stays, and the next sync tries again.
                setSync('offline');
            }
        })().finally(() => {
            running.current = null;
        });
        return running.current;
    }, [userId, keep]);

    // Signed in: what this phone kept opens at once, then the first sync.
    useEffect(() => {
        if (!userId) return;
        let live = true;
        AsyncStorage.getItem(ACCOUNT(userId))
            .catch(() => null)
            .then((text) => {
                if (!live) return;
                keep({ userId, groups: reviveAccount(text) });
                void refresh();
            });
        return () => {
            live = false;
        };
    }, [userId, keep, refresh]);

    // Back in front: up to date again; while in front: every minute.
    useEffect(() => {
        if (!userId) return;
        let timer: ReturnType<typeof setInterval> | null = setInterval(() => void refresh(), EVERY_MS);
        const listener = AppState.addEventListener('change', (state) => {
            if (timer) clearInterval(timer);
            timer = null;
            if (state === 'active') {
                void refresh();
                timer = setInterval(() => void refresh(), EVERY_MS);
            }
        });
        return () => {
            listener.remove();
            if (timer) clearInterval(timer);
        };
    }, [userId, refresh]);

    // Signed out: this phone forgets every account's groups.
    useEffect(() => {
        if (auth.status !== 'signed_out') return;
        kept.current = null;
        AsyncStorage.getAllKeys()
            .then((keys) => AsyncStorage.multiRemove(keys.filter((key) => key.startsWith('splitit.account.'))))
            .catch(() => undefined);
    }, [auth.status]);

    const real = auth.status === 'signed_in';
    const accountView = useMemo(() => (mine && userId ? accountLedger(mine.groups, userId) : EMPTY), [mine, userId]);
    const ledger = real ? accountView : demo;

    // ── Changes ──
    const resetLedger = useCallback(() => setDemo(seedLedger()), []);

    const addExpense = useCallback(
        (input: NewExpense) => {
            if (real) throw new NotYet();
            const target = demo.groups.find((group) => group.id === input.groupId);
            if (!target) throw new Error('That group is gone');
            const expense = makeExpense({ ...input, id: nextId('e'), createdAt: new Date() }, target);
            setDemo((current) => ({ ...current, expenses: [...current.expenses, expense] }));
            return expense;
        },
        [demo.groups, real],
    );

    const recordPayment = useCallback(
        (input: { groupId: string; fromId: string; toId: string; amount: number; method: string }) => {
            if (real) throw new NotYet();
            const settlement: Settlement = { ...input, id: nextId('s'), status: 'completed', createdAt: new Date() };
            setDemo((current) => ({ ...current, settlements: [...current.settlements, settlement] }));
            return settlement;
        },
        [real],
    );

    const deleteExpense = useCallback(
        (id: string) => {
            if (real) throw new NotYet();
            setDemo((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== id) }));
        },
        [real],
    );

    const setReceipt = useCallback(
        (id: string, uri: string | null) => {
            if (real) throw new NotYet();
            setDemo((current) => ({ ...current, expenses: current.expenses.map((expense) => (expense.id === id ? { ...expense, receipt: uri } : expense)) }));
        },
        [real],
    );

    const sendMessage = useCallback(
        (groupId: string, text: string) => {
            if (real) throw new NotYet();
            const message: Message = { id: nextId('m'), groupId, fromId: ME, text, at: new Date() };
            setDemo((current) => ({ ...current, messages: [...current.messages, message] }));
        },
        [real],
    );

    const personOf = useCallback((id: string) => personIn(ledger, id), [ledger]);

    const value = useMemo(
        () => ({ ledger, personOf, real, sync: real ? sync : ('idle' as const), refresh, onRefresh: real ? refresh : undefined, addExpense, recordPayment, deleteExpense, setReceipt, sendMessage, resetLedger }),
        [ledger, personOf, real, sync, refresh, addExpense, recordPayment, deleteExpense, setReceipt, sendMessage, resetLedger],
    );
    return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLedger(): LedgerContext {
    const context = useContext(Context);
    if (!context) throw new Error('useLedger needs LedgerProvider above it');
    return context;
}

export { ME };
