import type { FinanceMember, FinanceSettlementSnapshot, FinanceTransactionSnapshot } from '@/lib/groupFinance';
import { equalShares } from '@/lib/splits';
import { createRandom } from './random';

export const FIXED_NOW = new Date('2026-09-01T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A random group history — expenses (some edited or deleted, with the audit
 * logs the app writes), and settlements in every status — reproducible from a seed.
 */
export function randomGroupHistory(seed: number) {
    const random = createRandom(seed);
    const members: FinanceMember[] = Array.from({ length: random.int(2, 9) }, (_, i) => ({
        id: `user-${i}`,
        name: `Member ${i}`,
        image: null,
        upiId: i % 2 === 0 ? `member${i}@upi` : null,
    }));
    const at = () => new Date(FIXED_NOW.getTime() - random.int(0, 45 * DAY_MS));

    const snapshot = (id: string, createdAt: Date): FinanceTransactionSnapshot => {
        const payer = random.pick(members);
        const participants = members.filter(() => random.next() < 0.6);
        const splitAmong = participants.length > 0 ? participants : [payer];
        const amount = random.int(1, 400_000);
        const shares = equalShares(amount, splitAmong.length);
        return {
            id,
            tripId: 'trip-1',
            tripTitle: 'Trip',
            title: `Expense ${id}`,
            amount,
            splitType: random.next() < 0.2 ? 'custom' : 'equal',
            payerId: payer.id,
            payerName: payer.name,
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
            splits: splitAmong.map((member, i) => ({ userId: member.id, userName: member.name, amount: shares[i] })),
        };
    };

    const transactions: FinanceTransactionSnapshot[] = [];
    const auditLogs: { id: string; action: string; entityId: string; details: unknown; createdAt: Date }[] = [];

    for (let t = 0; t < random.int(0, 30); t++) {
        const created = snapshot(`txn-${t}`, at());
        const roll = random.next();
        if (roll < 0.15) {
            // Edited: the audit log keeps the snapshots before and after.
            const edited = { ...snapshot(`txn-${t}`, created.createdAt), title: created.title };
            const editedAt = new Date(created.createdAt.getTime() + random.int(1, 3 * DAY_MS));
            auditLogs.push({ id: `log-${t}-c`, action: 'create', entityId: created.id, details: { after: created }, createdAt: created.createdAt });
            auditLogs.push({ id: `log-${t}-u`, action: 'update', entityId: created.id, details: { before: created, after: edited }, createdAt: editedAt });
            transactions.push({ ...edited, updatedAt: editedAt });
        } else if (roll < 0.25) {
            const deletedAt = new Date(created.createdAt.getTime() + random.int(1, 3 * DAY_MS));
            auditLogs.push({ id: `log-${t}-d`, action: 'delete', entityId: created.id, details: { before: created, after: null }, createdAt: deletedAt });
            transactions.push({ ...created, deletedAt });
        } else {
            transactions.push(created);
        }
    }

    const statuses = ['completed', 'confirmed', 'pending', 'initiated', 'paid_pending', 'cancelled'];
    const settlements: FinanceSettlementSnapshot[] = Array.from({ length: random.int(0, 8) }, (_, s) => {
        const from = random.pick(members);
        const to = random.pick(members.filter((member) => member.id !== from.id)) ?? from;
        const createdAt = at();
        return {
            id: `stl-${s}`,
            tripId: 'trip-1',
            tripTitle: 'Trip',
            fromId: from.id,
            fromName: from.name,
            toId: to.id,
            toName: to.name,
            amount: random.int(1, 150_000),
            status: random.pick(statuses),
            method: random.pick(['upi', 'cash', null]),
            note: null,
            createdAt,
            updatedAt: createdAt,
            deletedAt: random.next() < 0.1 ? createdAt : null,
        };
    });

    return { random, members, transactions, settlements, auditLogs };
}
