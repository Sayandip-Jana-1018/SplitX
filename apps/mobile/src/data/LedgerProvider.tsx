/** The ledger for the whole app: adding an expense or a payment updates every screen at once. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { makeExpense, seedLedger, ME, type Expense, type ExpenseInput, type Ledger, type Settlement } from './ledger';

export type NewExpense = Omit<ExpenseInput, 'id' | 'createdAt'>;

interface LedgerContext {
    ledger: Ledger;
    addExpense: (input: NewExpense) => Expense;
    recordPayment: (input: { groupId: string; fromId: string; toId: string; amount: number; method: string }) => Settlement;
}

const Context = createContext<LedgerContext | null>(null);
let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;

export function LedgerProvider({ children }: { children: ReactNode }) {
    const [ledger, setLedger] = useState<Ledger>(seedLedger);

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

    const value = useMemo(() => ({ ledger, addExpense, recordPayment }), [ledger, addExpense, recordPayment]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLedger(): LedgerContext {
    const context = useContext(Context);
    if (!context) throw new Error('useLedger needs LedgerProvider above it');
    return context;
}

export { ME };
