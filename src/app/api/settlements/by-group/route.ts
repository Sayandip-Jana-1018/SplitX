import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { loadGroupLedgers, planLedgerTransfers } from '@/lib/ledger';
import { logger } from '@/lib/logger';

// GET /api/settlements/by-group — every group's settle-up plan in one call.
//
// Balances cover all of a group's trips (lib/ledger.ts). This route used to read
// one arbitrary active trip per group, so Settle Up and the Dashboard missed
// expenses the group page showed. Suggested payments carry the group's default
// trip, which is where a payment made from Settle Up is recorded.
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) {
            return NextResponse.json({ groups: [], global: { computed: [], recorded: [] } });
        }

        const groups = await prisma.group.findMany({
            where: {
                deletedAt: null,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            select: { id: true },
        });

        const ledgers = (await loadGroupLedgers(groups.map((group) => group.id)))
            .filter((ledger) => ledger.defaultTripId !== null);

        const perGroupResults = ledgers.map((ledger) => {
            const tripId = ledger.defaultTripId as string;
            const computed = planLedgerTransfers(ledger).map((transfer) => ({
                ...transfer,
                tripId,
                groupId: ledger.groupId,
                groupName: ledger.groupName,
                groupEmoji: ledger.groupEmoji,
                groupBreakdown: [
                    {
                        groupName: ledger.groupName,
                        groupEmoji: ledger.groupEmoji,
                        amount: transfer.amount,
                    },
                ],
            }));

            return {
                groupId: ledger.groupId,
                groupName: ledger.groupName,
                groupEmoji: ledger.groupEmoji,
                tripId,
                members: ledger.members,
                computed,
                recorded: ledger.settlements,
            };
        });

        return NextResponse.json({
            groups: perGroupResults,
            global: {
                computed: perGroupResults.flatMap((group) => group.computed),
                recorded: perGroupResults
                    .flatMap((group) => group.recorded)
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
            },
        });
    } catch (error) {
        logger.error('Settlements by-group error', { err: error });
        return NextResponse.json({ error: 'Failed to compute settlements' }, { status: 500 });
    }
}
