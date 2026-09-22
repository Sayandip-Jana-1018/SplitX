'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import {
    AlertTriangle,
    ArrowDownWideNarrow,
    CalendarClock,
    Check,
    Pencil,
    Plus,
    ReceiptText,
    ScanLine,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Avatar from '@/components/ui/Avatar';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { TransactionSkeleton } from '@/components/ui/Skeleton';
import { CategoryTile, PaymentTag, getCategoryConfig } from '@/components/ui/Icons';
import { Amount, Chip, ChipRow, ListGroup, ListRow, Notice, Stagger, StaggerItem, Tag } from '@/components/ui/kit';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fetcher, refreshMoneyData } from '@/lib/swr';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { equalSharesById } from '@/lib/splits';
import styles from './transactions.module.css';

interface GroupMemberRef {
    userId: string;
    user: { id: string; name: string | null; image: string | null };
}

interface TransactionData {
    id: string;
    title: string;
    category: string;
    amount: number;
    method: string;
    createdAt: string;
    updatedAt?: string;
    payer: { id: string; name: string | null };
    splits: { userId: string; amount: number; user: { id: string; name: string | null } }[];
    splitType?: string;
    trip?: { group: { id?: string; name?: string; emoji?: string; ownerId?: string; members: GroupMemberRef[] } };
}

type SortKey = 'time' | 'amount';

const firstName = (name?: string | null) => (name || 'Someone').split(' ')[0];

function dayKey(iso: string) {
    return new Date(iso).toDateString();
}

function dayLabel(iso: string) {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    });
}

function timeLabel(iso: string) {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** What this expense means for the current user. */
function positionFor(txn: TransactionData, userId: string | undefined) {
    if (!userId) return { kind: 'neutral' as const, amount: 0 };
    const share = txn.splits.find((split) => split.userId === userId)?.amount ?? 0;
    if (txn.payer.id === userId) {
        const lent = txn.amount - share;
        return lent > 0 ? { kind: 'lend' as const, amount: lent } : { kind: 'self' as const, amount: 0 };
    }
    return share > 0 ? { kind: 'owe' as const, amount: share } : { kind: 'neutral' as const, amount: 0 };
}

export default function TransactionsPage() {
    return (
        <Suspense fallback={<TransactionSkeleton />}>
            <TransactionsContent />
        </Suspense>
    );
}

function TransactionsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user: currentUser } = useCurrentUser();
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<SortKey>('time');
    const [filterCategory, setFilterCategory] = useState<string | null>(null);
    const [sheetTxnId, setSheetTxnId] = useState<string | null>(() => searchParams.get('focus'));
    const [sheetOpen, setSheetOpen] = useState(() => Boolean(searchParams.get('focus')));

    const { data, error, isLoading, mutate } = useSWR<TransactionData[]>('/api/transactions?limit=100', fetcher, {
        keepPreviousData: true,
        revalidateOnFocus: true,
        dedupingInterval: 4000,
    });
    const transactions = useMemo(() => (Array.isArray(data) ? data : []), [data]);

    const categoriesInUse = useMemo(() => {
        const seen = new Map<string, number>();
        for (const txn of transactions) {
            const key = getCategoryConfig(txn.category).key === 'general' && txn.category && txn.category !== 'general'
                ? txn.category
                : getCategoryConfig(txn.category).key;
            seen.set(key, (seen.get(key) || 0) + 1);
        }
        return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).map(([key]) => key);
    }, [transactions]);

    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        let list = transactions;
        if (query) {
            list = list.filter((txn) =>
                txn.title.toLowerCase().includes(query)
                || (txn.payer.name || '').toLowerCase().includes(query)
                || (txn.trip?.group.name || '').toLowerCase().includes(query)
            );
        }
        if (filterCategory) {
            list = list.filter((txn) => {
                const config = getCategoryConfig(txn.category);
                return config.key === filterCategory || txn.category === filterCategory;
            });
        }
        if (sortBy === 'amount') list = [...list].sort((a, b) => b.amount - a.amount);
        return list;
    }, [filterCategory, search, sortBy, transactions]);

    const dayGroups = useMemo(() => {
        const groups: { key: string; label: string; total: number; items: TransactionData[] }[] = [];
        for (const txn of filtered) {
            const key = dayKey(txn.createdAt);
            let group = groups.find((entry) => entry.key === key);
            if (!group) {
                group = { key, label: dayLabel(txn.createdAt), total: 0, items: [] };
                groups.push(group);
            }
            group.total += txn.amount;
            group.items.push(txn);
        }
        return groups;
    }, [filtered]);

    const totalSpent = filtered.reduce((sum, txn) => sum + txn.amount, 0);
    const myShareTotal = currentUser
        ? filtered.reduce((sum, txn) => sum + (txn.splits.find((split) => split.userId === currentUser.id)?.amount ?? 0), 0)
        : 0;

    const sheetTxn = sheetTxnId ? transactions.find((txn) => txn.id === sheetTxnId) ?? null : null;

    const openSheet = (id: string) => {
        setSheetTxnId(id);
        setSheetOpen(true);
    };

    const closeSheet = () => {
        setSheetOpen(false);
        if (searchParams.get('focus')) router.replace('/transactions');
    };

    const handleChanged = async (removedId?: string) => {
        if (removedId) {
            await mutate((current) => (current || []).filter((txn) => txn.id !== removedId), { revalidate: false });
        }
        await Promise.all([mutate(), refreshMoneyData()]);
    };

    if (isLoading && !data) return <TransactionSkeleton />;

    if (error instanceof NetworkTaggedError && !data) {
        const copy = getNetworkErrorCopy(error.variant);
        return <ErrorState variant={error.variant} title={copy.title} message={copy.message} onRetry={() => mutate()} />;
    }

    const isFiltering = Boolean(search.trim() || filterCategory);

    return (
        <>
            <Stagger className={styles.page}>
                <StaggerItem>
                    <section className={styles.summary}>
                        <span className={styles.summaryLabel}>{isFiltering ? 'Matching expenses' : 'Total spent'}</span>
                        <span className={styles.summaryValue}>{formatCurrency(totalSpent)}</span>
                        <span className={styles.summaryMeta}>
                            {filtered.length} expense{filtered.length === 1 ? '' : 's'}
                            {currentUser && myShareTotal > 0 && <> · your share <strong>{formatCurrency(myShareTotal)}</strong></>}
                        </span>
                        <div className={styles.summaryActions}>
                            <Button variant="secondary" leftIcon={<ScanLine size={17} />} onClick={() => router.push('/transactions/scan')}>
                                Scan
                            </Button>
                            <Button leftIcon={<Plus size={17} />} onClick={() => router.push('/transactions/new')}>
                                Add expense
                            </Button>
                        </div>
                    </section>
                </StaggerItem>

                {transactions.length > 0 && (
                    <StaggerItem>
                        <div className={styles.toolbar}>
                            <label className={styles.search}>
                                <Search size={17} className={styles.searchIcon} />
                                <input
                                    className={styles.searchInput}
                                    placeholder="Search expenses, people, groups"
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    aria-label="Search expenses"
                                    enterKeyHint="search"
                                />
                                {search && (
                                    <button type="button" className={styles.searchClear} onClick={() => setSearch('')} aria-label="Clear search">
                                        <X size={14} />
                                    </button>
                                )}
                            </label>
                            <button
                                type="button"
                                className={cn(styles.sortButton, sortBy === 'amount' && styles.sortButtonActive)}
                                onClick={() => setSortBy(sortBy === 'time' ? 'amount' : 'time')}
                                aria-label={sortBy === 'time' ? 'Sort by highest amount' : 'Sort by most recent'}
                            >
                                {sortBy === 'time' ? <CalendarClock size={16} /> : <ArrowDownWideNarrow size={16} />}
                                {sortBy === 'time' ? 'Recent' : 'Highest'}
                            </button>
                        </div>
                    </StaggerItem>
                )}

                {categoriesInUse.length > 1 && (
                    <StaggerItem>
                        <ChipRow>
                            <Chip active={!filterCategory} onClick={() => setFilterCategory(null)}>All</Chip>
                            {categoriesInUse.map((key) => {
                                const config = getCategoryConfig(key);
                                const Icon = config.Icon;
                                return (
                                    <Chip
                                        key={key}
                                        active={filterCategory === key}
                                        onClick={() => setFilterCategory(filterCategory === key ? null : key)}
                                        icon={<Icon size={14} style={{ color: filterCategory === key ? undefined : config.color }} />}
                                    >
                                        {config.label}
                                    </Chip>
                                );
                            })}
                        </ChipRow>
                    </StaggerItem>
                )}

                <StaggerItem>
                    {filtered.length === 0 ? (
                        isFiltering ? (
                            <EmptyState
                                compact
                                icon={<Search size={22} />}
                                title="No matches"
                                description="Try a different search or clear the filter."
                                actionLabel="Clear filters"
                                actionIcon={<X size={16} />}
                                onAction={() => {
                                    setSearch('');
                                    setFilterCategory(null);
                                }}
                            />
                        ) : (
                            <EmptyState
                                icon={<ReceiptText size={26} />}
                                title="No expenses yet"
                                description="Every coffee, cab and shared adventure lands here. Add your first one in seconds."
                                actionLabel="Add expense"
                                actionHref="/transactions/new"
                            />
                        )
                    ) : sortBy === 'amount' ? (
                        <ListGroup>
                            {filtered.map((txn) => (
                                <TransactionRow key={txn.id} txn={txn} userId={currentUser?.id} onOpen={openSheet} showDate />
                            ))}
                        </ListGroup>
                    ) : (
                        <div className={styles.days}>
                            {dayGroups.map((group) => (
                                <section key={group.key} className={styles.day} aria-label={group.label}>
                                    <div className={styles.dayHead}>
                                        <span className={styles.dayLabel}>{group.label}</span>
                                        <span className={styles.dayTotal}>{formatCurrency(group.total)}</span>
                                    </div>
                                    <ListGroup>
                                        {group.items.map((txn) => (
                                            <TransactionRow key={txn.id} txn={txn} userId={currentUser?.id} onOpen={openSheet} />
                                        ))}
                                    </ListGroup>
                                </section>
                            ))}
                        </div>
                    )}
                    {filtered.length > 0 && transactions.length >= 100 && !isFiltering && (
                        <p className={styles.resultsNote}>Showing your 100 most recent expenses</p>
                    )}
                </StaggerItem>
            </Stagger>

            <Modal isOpen={sheetOpen && Boolean(sheetTxn)} onClose={closeSheet} title="Expense" size="small">
                {sheetTxn && (
                    <ExpenseSheetBody
                        key={sheetTxn.id}
                        txn={sheetTxn}
                        currentUserId={currentUser?.id}
                        onClose={closeSheet}
                        onChanged={handleChanged}
                    />
                )}
            </Modal>
        </>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Row
   ═══════════════════════════════════════════════════════════════ */

function TransactionRow({
    txn,
    userId,
    onOpen,
    showDate,
}: {
    txn: TransactionData;
    userId?: string;
    onOpen: (id: string) => void;
    showDate?: boolean;
}) {
    const position = positionFor(txn, userId);
    const payer = txn.payer.id === userId ? 'You' : firstName(txn.payer.name);
    const when = showDate ? formatDate(txn.createdAt) : timeLabel(txn.createdAt);
    const groupLabel = txn.trip?.group.name ? ` · ${txn.trip.group.emoji ?? ''} ${txn.trip.group.name}` : '';

    return (
        <motion.div layout="position" initial={false}>
            <ListRow
                onClick={() => onOpen(txn.id)}
                leading={<CategoryTile category={txn.category} />}
                title={txn.title}
                subtitle={`${payer} paid · ${when}${groupLabel}`}
                trailing={<Amount value={txn.amount} />}
                trailingSub={
                    position.kind === 'lend' ? <span className={styles.lend}>you lent {formatCurrency(position.amount)}</span>
                        : position.kind === 'owe' ? <span className={styles.owe}>you owe {formatCurrency(position.amount)}</span>
                            : position.kind === 'self' ? <span className={styles.neutral}>just you</span>
                                : <span className={styles.neutral}>not involved</span>
                }
            />
        </motion.div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Detail / edit sheet
   ═══════════════════════════════════════════════════════════════ */

function ExpenseSheetBody({
    txn,
    currentUserId,
    onClose,
    onChanged,
}: {
    txn: TransactionData;
    currentUserId?: string;
    onClose: () => void;
    onChanged: (removedId?: string) => Promise<void>;
}) {
    const { toast } = useToast();
    const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view');
    const [title, setTitle] = useState(txn.title);
    const [amount, setAmount] = useState(String(txn.amount / 100));
    const [splitAmong, setSplitAmong] = useState<Set<string>>(() => new Set(txn.splits.map((split) => split.userId)));
    const [busy, setBusy] = useState(false);

    const members = useMemo(() => txn.trip?.group.members ?? [], [txn.trip]);
    // Only equal splits are re-split here; custom (and percentage) shares keep their amounts.
    const isCustom = (txn.splitType ?? 'equal') !== 'equal';
    const canEdit = Boolean(currentUserId && (currentUserId === txn.payer.id || currentUserId === txn.trip?.group.ownerId));
    const category = getCategoryConfig(txn.category);
    const amountPaise = Math.round((parseFloat(amount) || 0) * 100);

    const people = useMemo(() => {
        if (members.length > 0) {
            return members.map((member) => ({
                id: member.userId,
                name: member.user.name || 'Member',
                image: member.user.image,
            }));
        }
        return txn.splits.map((split) => ({ id: split.userId, name: split.user.name || 'Member', image: null }));
    }, [members, txn.splits]);

    const shares = useMemo(() => {
        const map = new Map<string, number>();
        if (mode !== 'edit' || isCustom) {
            for (const split of txn.splits) map.set(split.userId, split.amount);
            return map;
        }
        const selected = people.filter((person) => splitAmong.has(person.id)).map((person) => person.id);
        // The same function the server uses, so the preview shows exactly what gets saved.
        return selected.length ? equalSharesById(amountPaise, selected) : map;
    }, [amountPaise, isCustom, mode, people, splitAmong, txn.splits]);

    const payerPerson = people.find((person) => person.id === txn.payer.id);

    const save = async () => {
        if (!title.trim() || amountPaise <= 0 || splitAmong.size === 0) {
            toast('Add a title, an amount and at least one person', 'error');
            return;
        }
        const sameSharers = splitAmong.size === txn.splits.length && txn.splits.every((split) => splitAmong.has(split.userId));
        if (title.trim() === txn.title && (isCustom || (amountPaise === txn.amount && sameSharers))) {
            setMode('view');
            return;
        }
        setBusy(true);
        try {
            const res = await fetch(`/api/transactions/${txn.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                // Only what changed, and the version being edited: if someone
                // else saved first, the server says so instead of overwriting.
                body: JSON.stringify({
                    title: title.trim(),
                    ...(isCustom ? {} : { amount: amountPaise, splitAmong: Array.from(splitAmong) }),
                    ...(txn.updatedAt ? { expectedUpdatedAt: txn.updatedAt } : {}),
                }),
            });
            if (res.ok) {
                toast('Expense updated', 'success');
                await onChanged();
                setMode('view');
            } else {
                const err = await res.json().catch(() => ({}));
                toast(err.error || 'Could not update this expense', 'error');
            }
        } catch {
            toast('Network error — please try again', 'error');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setBusy(true);
        try {
            const res = await fetch(`/api/transactions/${txn.id}`, { method: 'DELETE' });
            if (res.ok) {
                toast('Expense deleted', 'success');
                onClose();
                await onChanged(txn.id);
            } else {
                const err = await res.json().catch(() => ({}));
                toast(err.error || 'Could not delete this expense', 'error');
            }
        } catch {
            toast('Network error — please try again', 'error');
        } finally {
            setBusy(false);
        }
    };

    if (mode === 'delete') {
        return (
            <div className={styles.sheet}>
                <div className={styles.confirm}>
                    <span className={styles.confirmIcon}><Trash2 size={26} /></span>
                    <p className={styles.confirmTitle}>Delete “{txn.title}”?</p>
                    <p className={styles.confirmText}>
                        This removes the {formatCurrency(txn.amount)} expense and its splits for everyone in the group. Balances update instantly.
                    </p>
                </div>
                <div className={styles.sheetActions}>
                    <Button variant="secondary" onClick={() => setMode('view')} disabled={busy}>Keep it</Button>
                    <Button variant="danger" onClick={remove} loading={busy} leftIcon={<Trash2 size={16} />}>Delete</Button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.sheet}>
            <div className={styles.sheetHero}>
                <CategoryTile category={txn.category} size={60} />
                {mode === 'edit' ? null : (
                    <>
                        <p className={styles.sheetTitle}>{txn.title}</p>
                        <span className={styles.sheetAmount}>{formatCurrency(txn.amount)}</span>
                    </>
                )}
                <span className={styles.sheetMeta}>
                    Paid by {txn.payer.id === currentUserId ? 'you' : txn.payer.name || 'someone'} · {formatDate(txn.createdAt)}, {timeLabel(txn.createdAt)}
                </span>
                <div className={styles.sheetTags}>
                    <Tag tone="accent">{category.label}</Tag>
                    <PaymentTag method={txn.method} />
                    <Tag>{isCustom ? 'Custom split' : 'Split equally'}</Tag>
                    {txn.trip?.group.name && <Tag>{txn.trip.group.emoji} {txn.trip.group.name}</Tag>}
                </div>
            </div>

            {mode === 'edit' && (
                <div className={styles.editFields}>
                    <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} />
                    <Input
                        label="Amount (₹)"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                        inputMode="decimal"
                        disabled={isCustom}
                    />
                </div>
            )}

            {isCustom && mode === 'edit' && (
                <Notice tone="warning" icon={<AlertTriangle size={16} />}>
                    Custom split amounts can’t be changed here. Update the title, or delete and re-add the expense.
                </Notice>
            )}

            <div>
                <div className={styles.sheetSectionLabel}>{mode === 'edit' && !isCustom ? 'Split between' : 'Who owes what'}</div>
                {mode === 'edit' && !isCustom ? (
                    <div>
                        {people.map((person) => {
                            const on = splitAmong.has(person.id);
                            return (
                                <button
                                    key={person.id}
                                    type="button"
                                    className={cn(styles.memberToggle, on && styles.memberToggleOn)}
                                    onClick={() => {
                                        const next = new Set(splitAmong);
                                        if (next.has(person.id)) {
                                            if (next.size <= 1) return;
                                            next.delete(person.id);
                                        } else {
                                            next.add(person.id);
                                        }
                                        setSplitAmong(next);
                                    }}
                                    aria-pressed={on}
                                >
                                    <Avatar name={person.name} image={person.image} size="sm" />
                                    <span className={styles.memberName}>{person.id === currentUserId ? 'You' : person.name}</span>
                                    <span className={styles.memberShare}>{on ? formatCurrency(shares.get(person.id) ?? 0) : '—'}</span>
                                    <span className={cn(styles.check, on && styles.checkOn)}><Check size={14} strokeWidth={3} /></span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <ListGroup>
                        {people
                            .filter((person) => shares.has(person.id) || person.id === txn.payer.id)
                            .map((person) => {
                                const share = shares.get(person.id) ?? 0;
                                const isPayer = person.id === txn.payer.id;
                                const net = (isPayer ? txn.amount : 0) - share;
                                return (
                                    <ListRow
                                        key={person.id}
                                        leading={<Avatar name={person.name} image={person.image ?? payerPerson?.image} size="md" />}
                                        title={person.id === currentUserId ? 'You' : person.name}
                                        subtitle={isPayer ? `Paid ${formatCurrency(txn.amount)}` : `Share ${formatCurrency(share)}`}
                                        trailing={<Amount value={net} tone="auto" signed />}
                                        trailingSub={net > 0 ? 'gets back' : net < 0 ? 'owes' : 'even'}
                                    />
                                );
                            })}
                    </ListGroup>
                )}
            </div>

            {mode === 'edit' ? (
                <div className={styles.sheetActions}>
                    <Button variant="secondary" onClick={() => setMode('view')} disabled={busy}>Cancel</Button>
                    <Button onClick={save} loading={busy} leftIcon={<Check size={16} />}>Save changes</Button>
                </div>
            ) : canEdit ? (
                <div className={styles.sheetActions}>
                    <Button variant="secondary" leftIcon={<Pencil size={16} />} onClick={() => setMode('edit')}>Edit</Button>
                    <Button variant="ghost" leftIcon={<Trash2 size={16} />} onClick={() => setMode('delete')} style={{ color: 'var(--color-error)' }}>
                        Delete
                    </Button>
                </div>
            ) : (
                <Notice tone="info">Only the person who paid or the group owner can edit this expense.</Notice>
            )}
        </div>
    );
}
