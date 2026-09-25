'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface BalanceTransfer {
    from: string;
    to: string;
    amount: number;
    fromName?: string;
    toName?: string;
    fromImage?: string | null;
    toImage?: string | null;
    toUpiId?: string | null;
    tripId?: string;
    groupId?: string;
    groupName?: string;
    groupEmoji?: string;
    groupBreakdown?: { groupName: string; groupEmoji: string; amount: number }[];
}

interface RecordedSettlementData {
    id: string;
    tripId?: string;
    fromId: string;
    toId: string;
    amount: number;
    status: string;
    method: string | null;
    note: string | null;
    from: { id: string; name: string | null; image?: string | null };
    to: { id: string; name: string | null; image?: string | null };
    createdAt: string;
}

export interface GroupBalanceData {
    groupId: string;
    groupName: string;
    groupEmoji: string;
    tripId: string;
    members: { id: string; name: string; image: string | null }[];
    computed: BalanceTransfer[];
    recorded: RecordedSettlementData[];
}

export interface BalancesResponse {
    groups: GroupBalanceData[];
    global: { computed: BalanceTransfer[]; recorded: RecordedSettlementData[] };
}

interface GroupNet {
    net: number;
    youOwe: number;
    owedToYou: number;
}

const BALANCES_KEY = '/api/settlements/by-group';

/**
 * Single source of truth for "who owes whom" across the app.
 * Dashboard, Groups and Settle Up all read from the same cached query,
 * so the numbers can never disagree between screens.
 */
export function useBalances() {
    const { user } = useCurrentUser();
    const query = useSWR<BalancesResponse>(BALANCES_KEY, fetcher, {
        keepPreviousData: true,
        revalidateOnFocus: true,
        dedupingInterval: 4000,
    });

    const userId = user?.id ?? null;

    const summary = useMemo(() => {
        const computed = query.data?.global?.computed ?? [];
        const byGroup: Record<string, GroupNet> = {};
        let youOwe = 0;
        let owedToYou = 0;

        if (userId) {
            for (const transfer of computed) {
                const key = transfer.groupId ?? 'unknown';
                const entry = byGroup[key] ?? { net: 0, youOwe: 0, owedToYou: 0 };
                if (transfer.from === userId) {
                    youOwe += transfer.amount;
                    entry.youOwe += transfer.amount;
                    entry.net -= transfer.amount;
                } else if (transfer.to === userId) {
                    owedToYou += transfer.amount;
                    entry.owedToYou += transfer.amount;
                    entry.net += transfer.amount;
                }
                byGroup[key] = entry;
            }
        }

        const mine = userId
            ? computed.filter((transfer) => transfer.from === userId || transfer.to === userId)
            : [];

        return { youOwe, owedToYou, net: owedToYou - youOwe, byGroup, mine };
    }, [query.data, userId]);

    return {
        data: query.data,
        error: query.error,
        isLoading: query.isLoading,
        isValidating: query.isValidating,
        mutate: query.mutate,
        userId,
        ...summary,
    };
}
