/**
 * The ledger for the whole app: adding an expense or a payment updates every screen at once.
 *
 * - **Demo:** made-up people and money, kept on the phone, so what you add is still there when the
 *   app opens again; anything unreadable in storage is set aside for the made-up data.
 * - **Signed in:** your groups as the server last sent them (account.ts), kept on the phone per
 *   account so the app opens straight onto them, offline too. They're brought up to date when the
 *   app opens, when it comes back to the front, every minute while it's open, and on a pull-down.
 *   What you change is saved on the phone first and sent in order (outbox.ts); it shows at once,
 *   marked as sending. Signing out forgets all of it on this phone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { SyncGroup } from '@/lib/contract/v1';
import { api } from '~/api';
import { useAuth } from '~/auth/AuthProvider';
import { useToast } from '~/ui/Toast';
import { accountLedger, mergeSync, versionsOf } from './account';
import { makeExpense, personIn, PEOPLE, seedLedger, ME, type Expense, type ExpenseInput, type Ledger, type Message, type Person, type Settlement } from './ledger';
import { chatMessage, deleting, describe, reviveChanges, send, withChanges, type Change } from './outbox';

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
    /** Changes saved on the phone, not yet sent. */
    waiting: number;
    /** Brings your groups up to date now; nothing in the demo. */
    refresh: () => Promise<void>;
    /** For a screen's pull-down: only your real groups have anywhere to refresh from. */
    onRefresh: (() => Promise<void>) | undefined;
    addExpense: (input: NewExpense) => Expense;
    /** You paid someone (cash, or another way): they confirm it before balances move. */
    recordPayment: (input: { groupId: string; fromId: string; toId: string; amount: number; method: string }) => Settlement;
    deleteExpense: (id: string) => void;
    setReceipt: (id: string, uri: string | null) => void;
    /** `remind`: a payment reminder to that person, as the website sends. */
    sendMessage: (groupId: string, text: string, remind?: string) => void;
    /** Brings a group's chat from the server; nothing in the demo. */
    loadMessages: (groupId: string) => Promise<void>;
    /** Online only: you confirm a payment someone marked as paid to you; balances move. */
    confirmPayment: (settlementId: string) => Promise<void>;
    /** Online only: a new group, with you as its admin. Its id. */
    createGroup: (name: string, emoji: string) => Promise<string>;
    /** Online only: joins by an invite code or link. The group's id. */
    joinGroup: (codeOrLink: string) => Promise<string>;
    /** Back to the made-up starting data. */
    resetLedger: () => void;
}

const SAVED = 'splitit.ledger.v1';
const ACCOUNT = (userId: string) => `splitit.account.v1.${userId}`;
const OUTBOX = (userId: string) => `splitit.outbox.v1.${userId}`;
const RECEIPTS = (userId: string) => `splitit.receipts.v1.${userId}`;
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

function reviveReceipts(text: string | null): Record<string, string> {
    try {
        const raw: unknown = text ? JSON.parse(text) : null;
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
    } catch {
        return {};
    }
}

/** An invite link (…/join/<code>) or the code alone. */
const inviteCodeOf = (text: string) => text.trim().split('/join/').pop()?.split(/[?#\s]/)[0] ?? '';

const Context = createContext<LedgerContext | null>(null);
let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;

interface Account {
    userId: string;
    groups: SyncGroup[];
    changes: Change[];
    receipts: Record<string, string>;
}

export function LedgerProvider({ children }: { children: ReactNode }) {
    const auth = useAuth();
    const toast = useToast();
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
    const [account, setAccount] = useState<Account | null>(null);
    const [messages, setMessages] = useState<Record<string, Message[]>>({});
    const [sync, setSync] = useState<SyncState>('idle');
    const kept = useRef<Account | null>(null);
    const syncing = useRef<Promise<void> | null>(null);
    const flushing = useRef<Promise<void> | null>(null);
    const mine = account && account.userId === userId ? account : null;

    /** Keeps the account as `change` makes it, now and on the phone. Only for the signed-in account. */
    const update = useCallback((forUser: string, change: (current: Account) => Account) => {
        const current = kept.current;
        if (!current || current.userId !== forUser) return;
        const next = change(current);
        kept.current = next;
        setAccount(next);
        if (next.groups !== current.groups) AsyncStorage.setItem(ACCOUNT(forUser), JSON.stringify(next.groups)).catch(() => undefined);
        if (next.changes !== current.changes) AsyncStorage.setItem(OUTBOX(forUser), JSON.stringify(next.changes)).catch(() => undefined);
        if (next.receipts !== current.receipts) AsyncStorage.setItem(RECEIPTS(forUser), JSON.stringify(next.receipts)).catch(() => undefined);
    }, []);

    const refresh = useCallback(async () => {
        if (!userId) return;
        syncing.current ??= (async () => {
            setSync('syncing');
            try {
                const before = kept.current?.userId === userId ? kept.current.groups : [];
                const answer = await api.sync(versionsOf(before));
                update(userId, (current) => ({ ...current, groups: mergeSync(current.groups, answer) }));
                setSync('idle');
            } catch {
                // Offline or the server is having trouble: what's on the phone stays, and the next sync tries again.
                setSync('offline');
            }
        })().finally(() => {
            syncing.current = null;
        });
        return syncing.current;
    }, [userId, update]);

    /** Sends what's waiting, oldest first; stops at the first that has to wait, then brings everything up to date. */
    const flush = useCallback(async () => {
        if (!userId) return;
        flushing.current ??= (async () => {
            let sent = false;
            for (;;) {
                const next = kept.current?.userId === userId ? kept.current.changes[0] : undefined;
                if (!next) break;
                const result = await send(api, next);
                if (result.outcome === 'wait') {
                    setSync('offline');
                    break;
                }
                sent = true;
                update(userId, (current) => ({
                    ...current,
                    changes: current.changes.filter((change) => change.id !== next.id),
                    groups: result.outcome === 'saved' ? result.patch(current.groups) : current.groups,
                }));
                if (result.outcome === 'saved' && result.message && next.kind === 'message') {
                    const message = chatMessage(result.message, next.groupId, userId);
                    if (message) setMessages((current) => ({ ...current, [next.groupId]: [...(current[next.groupId] ?? []).filter((m) => m.id !== message.id), message] }));
                }
                if (result.outcome === 'refused') toast(`Couldn’t save ${describe(next)}: ${result.why}`, 'info');
            }
            if (sent) await refresh();
        })().finally(() => {
            flushing.current = null;
        });
        return flushing.current;
    }, [userId, update, refresh, toast]);

    /** Up to date both ways: what's waiting goes first, then the server's news comes. */
    const catchUp = useCallback(async () => {
        await flush();
        await refresh();
    }, [flush, refresh]);

    // The latest catch-up, for the effect below, which runs once per account rather than whenever it changes.
    const latestCatchUp = useRef(catchUp);
    useEffect(() => {
        latestCatchUp.current = catchUp;
    }, [catchUp]);

    // Signed in: what this phone kept opens at once, then the first catch-up.
    useEffect(() => {
        if (!userId) return;
        let live = true;
        Promise.all([ACCOUNT(userId), OUTBOX(userId), RECEIPTS(userId)].map((key) => AsyncStorage.getItem(key).catch(() => null))).then(([groups, changes, receipts]) => {
            if (!live) return;
            const next = { userId, groups: reviveAccount(groups), changes: reviveChanges(changes), receipts: reviveReceipts(receipts) };
            kept.current = next;
            setAccount(next);
            void latestCatchUp.current();
        });
        return () => {
            live = false;
        };
    }, [userId]);

    // Back in front: up to date again; while in front: every minute.
    useEffect(() => {
        if (!userId) return;
        let timer: ReturnType<typeof setInterval> | null = setInterval(() => void catchUp(), EVERY_MS);
        const listener = AppState.addEventListener('change', (state) => {
            if (timer) clearInterval(timer);
            timer = null;
            if (state === 'active') {
                void catchUp();
                timer = setInterval(() => void catchUp(), EVERY_MS);
            }
        });
        return () => {
            listener.remove();
            if (timer) clearInterval(timer);
        };
    }, [userId, catchUp]);

    // Signed out: this phone forgets every account's groups, waiting changes and receipt photos.
    useEffect(() => {
        if (auth.status !== 'signed_out') return;
        kept.current = null;
        AsyncStorage.getAllKeys()
            .then((keys) => AsyncStorage.multiRemove(keys.filter((key) => key.startsWith('splitit.account.') || key.startsWith('splitit.outbox.') || key.startsWith('splitit.receipts.'))))
            .catch(() => undefined);
    }, [auth.status]);

    const real = auth.status === 'signed_in';
    const accountView = useMemo(() => {
        if (!mine || !userId) return EMPTY;
        const synced = accountLedger(mine.groups, userId);
        const withMessages = { ...synced, messages: Object.values(messages).flat() };
        const view = withChanges(withMessages, mine.changes);
        // Receipt photos stay on this phone until Phase 3 uploads them.
        return { ...view, expenses: view.expenses.map((expense) => (mine.receipts[expense.id] ? { ...expense, receipt: mine.receipts[expense.id] } : expense)) };
    }, [mine, userId, messages]);
    const ledger = real ? accountView : demo;

    // ── Changes ──
    const resetLedger = useCallback(() => setDemo(seedLedger()), []);

    /** Saved on the phone, then sent. */
    const queue = useCallback(
        (change: Change) => {
            if (!userId) return;
            update(userId, (current) => ({ ...current, changes: [...current.changes, change] }));
            void flush();
        },
        [userId, update, flush],
    );

    /** Your id where the phone says ME. */
    const serverId = useCallback((id: string) => (id === ME && userId ? userId : id), [userId]);

    const addExpense = useCallback(
        (input: NewExpense) => {
            const target = ledger.groups.find((group) => group.id === input.groupId);
            if (!target) throw new Error('That group is gone');
            if (!real) {
                const expense = makeExpense({ ...input, id: nextId('e'), createdAt: new Date() }, target);
                setDemo((current) => ({ ...current, expenses: [...current.expenses, expense] }));
                return expense;
            }
            const clientId = Crypto.randomUUID();
            const expense = makeExpense({ ...input, id: clientId, createdAt: new Date() }, target);
            queue({
                kind: 'expense',
                id: clientId,
                local: expense,
                body: {
                    clientId,
                    groupId: target.id,
                    title: expense.title,
                    amount: expense.amount,
                    category: expense.category,
                    payerId: serverId(expense.payerId),
                    splitType: expense.splitType,
                    ...(expense.splitType === 'equal'
                        ? { splitAmong: (input.among ?? target.memberIds).map(serverId) }
                        : { splits: expense.splits.map((split) => ({ userId: serverId(split.userId), amount: split.amount })) }),
                },
            });
            return expense;
        },
        [ledger.groups, real, queue, serverId],
    );

    const recordPayment = useCallback(
        (input: { groupId: string; fromId: string; toId: string; amount: number; method: string }) => {
            if (!real) {
                const settlement: Settlement = { ...input, id: nextId('s'), status: 'completed', createdAt: new Date() };
                setDemo((current) => ({ ...current, settlements: [...current.settlements, settlement] }));
                return settlement;
            }
            const id = Crypto.randomUUID();
            // Waiting for them to confirm, as on the website: it moves no balance until they do.
            const settlement: Settlement = { ...input, id, status: 'paid_pending', createdAt: new Date() };
            queue({ kind: 'payment', id, local: settlement, cash: input.method === 'cash', body: { groupId: input.groupId, toUserId: serverId(input.toId), amount: input.amount, method: input.method } });
            return settlement;
        },
        [real, queue, serverId],
    );

    const deleteExpense = useCallback(
        (id: string) => {
            if (!real) {
                setDemo((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== id) }));
                return;
            }
            const expense = ledger.expenses.find((candidate) => candidate.id === id);
            if (!expense || !userId) return;
            update(userId, (current) => ({ ...current, changes: deleting(current.changes, id, expense.groupId) }));
            void flush();
        },
        [real, ledger.expenses, userId, update, flush],
    );

    const setReceipt = useCallback(
        (id: string, uri: string | null) => {
            if (!real) {
                setDemo((current) => ({ ...current, expenses: current.expenses.map((expense) => (expense.id === id ? { ...expense, receipt: uri } : expense)) }));
                return;
            }
            if (!userId) return;
            update(userId, (current) => {
                const receipts = { ...current.receipts };
                if (uri) receipts[id] = uri;
                else delete receipts[id];
                return { ...current, receipts };
            });
        },
        [real, userId, update],
    );

    const sendMessage = useCallback(
        (groupId: string, text: string, remind?: string) => {
            if (!real) {
                const message: Message = { id: nextId('m'), groupId, fromId: ME, text, at: new Date() };
                setDemo((current) => ({ ...current, messages: [...current.messages, message] }));
                return;
            }
            const id = Crypto.randomUUID();
            const body = remind ? { content: text, type: 'payment_reminder' as const, targetUserId: serverId(remind) } : { content: text, type: 'text' as const };
            queue({ kind: 'message', id, groupId, body, local: { id, groupId, fromId: ME, text, at: new Date() } });
        },
        [real, queue, serverId],
    );

    const loadMessages = useCallback(
        async (groupId: string) => {
            if (!userId) return;
            try {
                const page = await api.messages(groupId);
                const loaded = page.messages.flatMap((message) => {
                    const mapped = chatMessage(message, groupId, userId);
                    return mapped ? [mapped] : [];
                });
                setMessages((current) => ({ ...current, [groupId]: loaded }));
            } catch {
                // Offline: the chat shows what it had.
            }
        },
        [userId],
    );

    const confirmPayment = useCallback(
        async (settlementId: string) => {
            await api.moveSettlement(settlementId, { action: 'approve' });
            await refresh();
        },
        [refresh],
    );

    const createGroup = useCallback(
        async (name: string, emoji: string) => {
            const { groupId } = await api.createGroup({ name, emoji });
            await refresh();
            return groupId;
        },
        [refresh],
    );

    const joinGroup = useCallback(
        async (codeOrLink: string) => {
            const { groupId } = await api.joinGroup(inviteCodeOf(codeOrLink));
            await refresh();
            return groupId;
        },
        [refresh],
    );

    const personOf = useCallback((id: string) => personIn(ledger, id), [ledger]);
    const waiting = real ? (mine?.changes.length ?? 0) : 0;

    const value = useMemo(
        () => ({
            ledger,
            personOf,
            real,
            sync: real ? sync : ('idle' as const),
            waiting,
            refresh: catchUp,
            onRefresh: real ? catchUp : undefined,
            addExpense,
            recordPayment,
            deleteExpense,
            setReceipt,
            sendMessage,
            loadMessages,
            confirmPayment,
            createGroup,
            joinGroup,
            resetLedger,
        }),
        [ledger, personOf, real, sync, waiting, catchUp, addExpense, recordPayment, deleteExpense, setReceipt, sendMessage, loadMessages, confirmPayment, createGroup, joinGroup, resetLedger],
    );
    return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLedger(): LedgerContext {
    const context = useContext(Context);
    if (!context) throw new Error('useLedger needs LedgerProvider above it');
    return context;
}

export { ME };
