'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Image as ImageIcon, ScanLine, Users } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { Chip, ChipRow, StatTile, Stagger, StaggerItem } from '@/components/ui/kit';
import { ReceiptGrid, ReceiptGridSkeleton, ReceiptViewer, type ReceiptView } from '@/components/features/ReceiptGallery';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { fetcher } from '@/lib/swr';
import { formatCurrency } from '@/lib/utils';
import styles from './receipts.module.css';

interface ReceiptEntry {
    id: string;
    title: string;
    amount: number;
    category: string;
    receiptUrl: string;
    date: string;
    payer: { id: string; name: string | null; image: string | null };
}

interface ReceiptsPayload {
    receipts: ReceiptEntry[];
    members: { id: string; name: string; image: string | null }[];
}

export default function GroupReceiptsPage() {
    const params = useParams();
    const groupId = params.groupId as string;
    const { data, error, isLoading, mutate } = useSWR<ReceiptsPayload>(
        groupId ? `/api/groups/${groupId}/receipts` : null,
        fetcher
    );
    const [payer, setPayer] = useState('all');
    const [open, setOpen] = useState<ReceiptView | null>(null);

    // Only people who actually paid for a receipt get a filter chip.
    const payers = useMemo(() => {
        const ids = new Set((data?.receipts ?? []).map((receipt) => receipt.payer.id));
        return (data?.members ?? []).filter((member) => ids.has(member.id));
    }, [data]);

    const visible = useMemo<ReceiptView[]>(
        () => (data?.receipts ?? [])
            .filter((receipt) => payer === 'all' || receipt.payer.id === payer)
            .map((receipt) => ({
                id: receipt.id,
                title: receipt.title,
                amount: receipt.amount,
                category: receipt.category,
                date: receipt.date,
                imageUrl: receipt.receiptUrl,
                payerName: receipt.payer.name,
            })),
        [data, payer]
    );

    const total = visible.reduce((sum, receipt) => sum + receipt.amount, 0);

    if (error && !data) {
        const variant = error instanceof NetworkTaggedError ? error.variant : 'default';
        const copy = getNetworkErrorCopy(variant);
        return <ErrorState variant={variant} title={copy.title} message={copy.message} onRetry={() => mutate()} />;
    }

    if (isLoading && !data) {
        return (
            <div className={styles.page}>
                <ReceiptGridSkeleton count={6} />
            </div>
        );
    }

    return (
        <>
            <Stagger className={styles.page}>
                {(data?.receipts.length ?? 0) === 0 ? (
                    <StaggerItem>
                        <EmptyState
                            icon={<ImageIcon size={26} />}
                            title="No receipts in this group yet"
                            description="Scan bills while adding expenses and they’ll collect here for everyone in the group."
                            actionLabel="Scan a receipt"
                            actionHref={`/transactions/scan?groupId=${groupId}`}
                            actionIcon={<ScanLine size={16} />}
                        />
                    </StaggerItem>
                ) : (
                    <>
                        <StaggerItem>
                            <div className={styles.stats}>
                                <StatTile label="Receipts" value={visible.length} />
                                <StatTile label={payer === 'all' ? 'Total' : 'Paid by them'} value={formatCurrency(total)} />
                            </div>
                        </StaggerItem>
                        {payers.length > 1 && (
                            <StaggerItem>
                                <ChipRow center>
                                    <Chip active={payer === 'all'} onClick={() => setPayer('all')} icon={<Users size={14} />}>
                                        Everyone
                                    </Chip>
                                    {payers.map((member) => (
                                        <Chip
                                            key={member.id}
                                            active={payer === member.id}
                                            onClick={() => setPayer(member.id)}
                                            icon={<Avatar name={member.name} image={member.image} size="xs" />}
                                        >
                                            {member.name.split(' ')[0]}
                                        </Chip>
                                    ))}
                                </ChipRow>
                            </StaggerItem>
                        )}
                        <StaggerItem>
                            <ReceiptGrid receipts={visible} onOpen={setOpen} />
                        </StaggerItem>
                    </>
                )}
            </Stagger>
            <ReceiptViewer receipt={open} onClose={() => setOpen(null)} />
        </>
    );
}
