'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { GitBranch, Plus } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Amount, IconTile, ListGroup, ListRow, PageIntro, Stagger, StaggerItem } from '@/components/ui/kit';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { fetcher } from '@/lib/swr';
import { formatCurrency } from '@/lib/utils';
import styles from './history.module.css';

interface GroupSummary {
    id: string;
    name: string;
    emoji: string;
    totalSpent: number;
    members: { user: { id: string; name: string | null; image: string | null } }[];
}

interface JourneyPreview {
    currentBalance: number;
    currentRouteSummary: string;
    changeCountThisWeek: number;
}

const PREVIEW_PREFIX = 'journey-previews:';

async function fetchPreviews(key: string): Promise<Record<string, JourneyPreview>> {
    const ids = key.slice(PREVIEW_PREFIX.length).split(',').filter(Boolean);
    const results = await Promise.all(ids.map(async (id) => {
        try {
            const response = await fetch(`/api/groups/${id}/balance-history?limit=1`);
            if (!response.ok) return null;
            const history = await response.json();
            const preview: JourneyPreview = {
                currentBalance: history.currentBalance || 0,
                currentRouteSummary: history.currentRouteSummary || 'All settled up',
                changeCountThisWeek: history.changeCountThisWeek || 0,
            };
            return [id, preview] as const;
        } catch {
            return null;
        }
    }));
    return Object.fromEntries(results.filter((entry): entry is readonly [string, JourneyPreview] => entry !== null));
}

export default function HistoryPage() {
    const router = useRouter();
    const { data, error, isLoading, mutate } = useSWR<GroupSummary[]>('/api/groups', fetcher);
    const groups = useMemo(() => (Array.isArray(data) ? data : []), [data]);
    const previewKey = groups.length > 1 ? `${PREVIEW_PREFIX}${groups.map((group) => group.id).join(',')}` : null;
    const { data: previews } = useSWR(previewKey, fetchPreviews);

    // With a single group there is nothing to choose — go straight to its journey.
    useEffect(() => {
        if (groups.length === 1) router.replace(`/groups/${groups[0].id}/journey`);
    }, [groups, router]);

    if ((isLoading && !data) || groups.length === 1) {
        return (
            <div className={styles.page}>
                <ListSkeleton rows={3} />
            </div>
        );
    }

    if (error && !data) {
        const variant = error instanceof NetworkTaggedError ? error.variant : 'default';
        const copy = getNetworkErrorCopy(variant);
        return <ErrorState variant={variant} title={copy.title} message={copy.message} onRetry={() => mutate()} />;
    }

    if (groups.length === 0) {
        return (
            <div className={styles.page}>
                <EmptyState
                    icon={<GitBranch size={26} />}
                    title="No journeys yet"
                    description="Create or join a group — SplitX records every change to your balance there."
                    actionLabel="Create a group"
                    actionHref="/groups?create=1"
                    actionIcon={<Plus size={16} />}
                />
            </div>
        );
    }

    return (
        <Stagger className={styles.page}>
            <StaggerItem>
                <PageIntro
                    eyebrow="Balance journey"
                    title="Every balance has a story"
                    subtitle="Only your own balance changes. Pick a group to replay how it moved."
                />
            </StaggerItem>
            <StaggerItem>
                <ListGroup>
                    {groups.map((group) => {
                        const preview = previews?.[group.id];
                        return (
                            <ListRow
                                key={group.id}
                                href={`/groups/${group.id}/journey`}
                                leading={<IconTile size={44}><span className={styles.emoji}>{group.emoji}</span></IconTile>}
                                title={group.name}
                                subtitle={preview?.currentRouteSummary
                                    ?? `${group.members.length} members · ${formatCurrency(group.totalSpent)} spent`}
                                trailing={preview ? <Amount value={preview.currentBalance} tone="auto" signed /> : undefined}
                                trailingSub={preview ? `${preview.changeCountThisWeek} this week` : undefined}
                                chevron
                            />
                        );
                    })}
                </ListGroup>
            </StaggerItem>
        </Stagger>
    );
}
