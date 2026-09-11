'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import { Image as ImageIcon, ScanLine, Search, X } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { IconButton, StatTile, Stagger, StaggerItem } from '@/components/ui/kit';
import { ReceiptGrid, ReceiptGridSkeleton, ReceiptViewer, type ReceiptView } from '@/components/features/ReceiptGallery';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { fetcher } from '@/lib/swr';
import { formatCurrency } from '@/lib/utils';
import styles from './receipts.module.css';

interface TransactionLite {
    id: string;
    title: string;
    amount: number;
    category?: string | null;
    createdAt: string;
    date?: string | null;
    receiptUrl?: string | null;
    payer?: { name: string | null } | null;
}

/** Older builds kept receipt thumbnails on-device under this key. */
const LEGACY_RECEIPTS_KEY = 'SplitX_receipts';

function subscribeToStorage(callback: () => void) {
    window.addEventListener('storage', callback);
    return () => window.removeEventListener('storage', callback);
}

function readLegacyReceipts() {
    try {
        return localStorage.getItem(LEGACY_RECEIPTS_KEY);
    } catch {
        return null;
    }
}

export default function ReceiptsPage() {
    const { data, error, isLoading, mutate } = useSWR<TransactionLite[]>('/api/transactions?limit=100', fetcher);
    const legacyRaw = useSyncExternalStore(subscribeToStorage, readLegacyReceipts, () => null);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState<ReceiptView | null>(null);

    const receipts = useMemo<ReceiptView[]>(() => {
        let legacy: Record<string, string> = {};
        try {
            legacy = legacyRaw ? JSON.parse(legacyRaw) : {};
        } catch {
            legacy = {};
        }
        return (Array.isArray(data) ? data : []).flatMap((transaction) => {
            const imageUrl = transaction.receiptUrl || legacy[transaction.id];
            if (!imageUrl) return [];
            return [{
                id: transaction.id,
                title: transaction.title,
                amount: transaction.amount,
                category: transaction.category || 'general',
                date: transaction.date || transaction.createdAt,
                imageUrl,
                payerName: transaction.payer?.name ?? null,
            }];
        });
    }, [data, legacyRaw]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? receipts.filter((receipt) => receipt.title.toLowerCase().includes(q)) : receipts;
    }, [receipts, query]);

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
                {receipts.length === 0 ? (
                    <StaggerItem>
                        <EmptyState
                            icon={<ImageIcon size={26} />}
                            title="No receipts yet"
                            description="Scan a bill when you add an expense — it lands here, searchable forever."
                            actionLabel="Scan a receipt"
                            actionHref="/transactions/scan"
                            actionIcon={<ScanLine size={16} />}
                        />
                    </StaggerItem>
                ) : (
                    <>
                        <StaggerItem>
                            <div className={styles.stats}>
                                <StatTile label="Receipts" value={visible.length} />
                                <StatTile label={query ? 'Matching total' : 'Total'} value={formatCurrency(total)} />
                            </div>
                        </StaggerItem>
                        <StaggerItem>
                            <div className={styles.toolbar}>
                                <Input
                                    aria-label="Search receipts"
                                    placeholder="Search receipts"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    leftIcon={<Search size={17} />}
                                    rightSlot={query ? (
                                        <button type="button" className={styles.clearButton} onClick={() => setQuery('')} aria-label="Clear search">
                                            <X size={14} />
                                        </button>
                                    ) : undefined}
                                />
                                <IconButton icon={<ScanLine size={19} />} label="Scan a receipt" variant="solid" size="lg" href="/transactions/scan" />
                            </div>
                        </StaggerItem>
                        <StaggerItem>
                            {visible.length === 0 ? (
                                <EmptyState
                                    compact
                                    icon={<Search size={22} />}
                                    title="No matches"
                                    description={`No receipt matches “${query}”.`}
                                />
                            ) : (
                                <ReceiptGrid receipts={visible} onOpen={setOpen} />
                            )}
                        </StaggerItem>
                    </>
                )}
            </Stagger>
            <ReceiptViewer receipt={open} onClose={() => setOpen(null)} />
        </>
    );
}
