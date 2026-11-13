/**
 * The ledger for the whole app: adding an expense or a payment updates every screen at once. It is
 * kept on the phone, so what you add is still there when the app opens again; anything unreadable
 * in storage is set aside and the app starts from the made-up data instead.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { makeExpense, seedLedger, ME, type Expense, type ExpenseInput, type Ledger, type Message, type Settlement } from './ledger';

export type NewExpense = Omit<ExpenseInput, 'id' | 'createdAt'>;

interface LedgerContext {
    ledger: Ledger;
    addExpense: (input: NewExpense) => Expense;
    recordPayment: (input: { groupId: string; fromId: string; toId: string; amount: number; method: string }) => Settlement;
    deleteExpense: (id: string) => void;
    setReceipt: (id: string, uri: string | null) => void;
    sendMessage: (groupId: string, text: string) => void;
    /** Back to the made-up starting data. */
    resetLedger: () => void;
}

const SAVED = 'splitit.ledger.v1';

/** The saved ledger, with its dates turned back into dates; null if it can't be read. */
function revive(text: string): Ledger | null {
    try {
        const raw = JSON.parse(text);
        if (!raw || !Array.isArray(raw.groups) || !Array.isArray(raw.expenses) || !Array.isArray(raw.settlements)) return null;
        const date = (value: unknown) => {
            const parsed = new Date(String(value));
            return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
        };
        return {
            groups: raw.groups,
            expenses: raw.expenses.map((expense: Expense) => ({ ...expense, createdAt: date(expense.createdAt) })),
            settlements: raw.settlements.map((settlement: Settlement) => ({ ...settlement, createdAt: date(settlement.createdAt) })),
            messages: Array.isArray(raw.messages) ? raw.messages.map((message: Message) => ({ ...message, at: date(message.at) })) : [],
        };
    } catch {
        return null;
    }
}

const Context = createContext<LedgerContext | null>(null);
let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;

export function LedgerProvider({ children }: { children: ReactNode }) {
    const [ledger, setLedger] = useState<Ledger>(seedLedger);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        AsyncStorage.getItem(SAVED)
            .then((text) => {
                const saved = text ? revive(text) : null;
                if (saved) setLedger(saved);
            })
            .catch(() => undefined)
            .finally(() => setLoaded(true));
    }, []);

    // Saved a moment after each change, once what was saved before has been read.
    useEffect(() => {
        if (!loaded) return;
        const timer = setTimeout(() => {
            AsyncStorage.setItem(SAVED, JSON.stringify(ledger)).catch(() => undefined);
        }, 400);
        return () => clearTimeout(timer);
    }, [ledger, loaded]);

    const resetLedger = useCallback(() => setLedger(seedLedger()), []);

    const addExpense = useCallback(
        (input: NewExpense) => {
            const target = ledger.groups.find((group) => group.id === input.groupId);
            if (!target) throw new Error('That group is gone');
            const expense = makeExpense({ ...input, id: nextId('e'), createdAt: new Date() }, target);
            setLedger((current) => ({ ...current, expenses: [...current.expenses, expense] }));
            return expense;
        },
        [ledger.groups],
    );

    const recordPayment = useCallback((input: { groupId: string; fromId: string; toId: string; amount: number; method: string }) => {
        const settlement: Settlement = { ...input, id: nextId('s'), status: 'completed', createdAt: new Date() };
        setLedger((current) => ({ ...current, settlements: [...current.settlements, settlement] }));
        return settlement;
    }, []);

    const deleteExpense = useCallback((id: string) => {
        setLedger((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== id) }));
    }, []);

    const setReceipt = useCallback((id: string, uri: string | null) => {
        setLedger((current) => ({ ...current, expenses: current.expenses.map((expense) => (expense.id === id ? { ...expense, receipt: uri } : expense)) }));
    }, []);

    const sendMessage = useCallback((groupId: string, text: string) => {
        const message: Message = { id: nextId('m'), groupId, fromId: ME, text, at: new Date() };
        setLedger((current) => ({ ...current, messages: [...current.messages, message] }));
    }, []);

    const value = useMemo(
        () => ({ ledger, addExpense, recordPayment, deleteExpense, setReceipt, sendMessage, resetLedger }),
        [ledger, addExpense, recordPayment, deleteExpense, setReceipt, sendMessage, resetLedger],
    );
    return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLedger(): LedgerContext {
    const context = useContext(Context);
    if (!context) throw new Error('useLedger needs LedgerProvider above it');
    return context;
}

export { ME };
