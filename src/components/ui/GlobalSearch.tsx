'use client';

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
    type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRightLeft, CornerDownLeft, Loader2, Plus, ScanLine, Search, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
import { useIsClient } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import styles from './search.module.css';

interface SearchGroup {
    id: string;
    name: string;
    emoji: string;
    _count: { members: number };
}

interface SearchTransaction {
    id: string;
    title: string;
    amount: number;
    category: string;
    createdAt: string;
    payer: { id: string; name: string | null };
    trip: { group: { id: string; name: string; emoji: string } };
}

interface SearchResults {
    groups: SearchGroup[];
    transactions: SearchTransaction[];
}

interface ResultItem {
    key: string;
    section: 'Quick actions' | 'Groups' | 'Expenses';
    title: string;
    subtitle: string;
    href: string;
    icon: ReactNode;
    trailing?: string;
}

const EMPTY_RESULTS: SearchResults = { groups: [], transactions: [] };

const QUICK_ACTIONS: ResultItem[] = [
    { key: 'qa-add', section: 'Quick actions', title: 'Add an expense', subtitle: 'Split a new bill with your group', href: '/transactions/new', icon: <Plus size={18} /> },
    { key: 'qa-settle', section: 'Quick actions', title: 'Settle up', subtitle: 'See who owes whom', href: '/settlements', icon: <ArrowRightLeft size={18} /> },
    { key: 'qa-groups', section: 'Quick actions', title: 'Groups', subtitle: 'Create or join a group', href: '/groups', icon: <Users size={18} /> },
    { key: 'qa-scan', section: 'Quick actions', title: 'Scan a receipt', subtitle: 'Extract the amount automatically', href: '/transactions/scan', icon: <ScanLine size={18} /> },
];

/**
 * Command-palette search. Controlled by the app shell; ⌘K / Ctrl+K toggles it.
 */
export default function GlobalSearch({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: Dispatch<SetStateAction<boolean>>;
}) {
    const mounted = useIsClient();

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                onOpenChange((previous) => !previous);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onOpenChange]);

    if (!mounted) return null;

    return createPortal(
        <AnimatePresence>
            {open && <SearchPalette key="search-palette" onClose={() => onOpenChange(false)} />}
        </AnimatePresence>,
        document.body
    );
}

function SearchPalette({ onClose }: { onClose: () => void }) {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
    const [searching, setSearching] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestRef = useRef(0);

    useEffect(() => {
        const frame = requestAnimationFrame(() => inputRef.current?.focus());
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            cancelAnimationFrame(frame);
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', onKey);
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [onClose]);

    const runSearch = useCallback(async (value: string) => {
        requestRef.current += 1;
        const requestId = requestRef.current;
        const trimmed = value.trim();
        if (trimmed.length < 2) {
            setResults(EMPTY_RESULTS);
            setSearching(false);
            return;
        }
        setSearching(true);
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
            const data: SearchResults = response.ok ? await response.json() : EMPTY_RESULTS;
            if (requestId === requestRef.current) setResults(data);
        } catch {
            if (requestId === requestRef.current) setResults(EMPTY_RESULTS);
        } finally {
            if (requestId === requestRef.current) setSearching(false);
        }
    }, []);

    const handleQueryChange = (value: string) => {
        setQuery(value);
        setActiveIndex(0);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(value), 220);
    };

    const items = useMemo<ResultItem[]>(() => {
        if (query.trim().length < 2) return QUICK_ACTIONS;
        const groupItems: ResultItem[] = results.groups.map((group) => ({
            key: `g-${group.id}`,
            section: 'Groups',
            title: group.name,
            subtitle: `${group._count.members} member${group._count.members === 1 ? '' : 's'}`,
            href: `/groups/${group.id}`,
            icon: <span>{group.emoji}</span>,
        }));
        const expenseItems: ResultItem[] = results.transactions.map((transaction) => ({
            key: `t-${transaction.id}`,
            section: 'Expenses',
            title: transaction.title,
            subtitle: `${transaction.trip.group.name} · Paid by ${transaction.payer.name || 'Unknown'}`,
            href: `/transactions?focus=${transaction.id}`,
            icon: <span>{transaction.trip.group.emoji}</span>,
            trailing: formatCurrency(transaction.amount),
        }));
        return [...groupItems, ...expenseItems];
    }, [query, results]);

    const open = (item: ResultItem) => {
        onClose();
        router.push(item.href);
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => (items.length ? (index + 1) % items.length : 0));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => (items.length ? (index - 1 + items.length) % items.length : 0));
        } else if (event.key === 'Enter' && items[activeIndex]) {
            event.preventDefault();
            open(items[activeIndex]);
        }
    };

    const showNoResults = query.trim().length >= 2 && !searching && items.length === 0;
    let lastSection: string | null = null;

    return (
        <motion.div
            className={styles.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
        >
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Search"
                className={styles.palette}
                initial={{ opacity: 0, y: -14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ type: 'spring', damping: 32, stiffness: 420 }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className={styles.inputRow}>
                    {searching ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(event) => handleQueryChange(event.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search groups, expenses, people…"
                        className={styles.input}
                        enterKeyHint="search"
                        aria-label="Search"
                    />
                    {query && (
                        <button type="button" className={styles.clear} onClick={() => handleQueryChange('')} aria-label="Clear search">
                            <X size={14} />
                        </button>
                    )}
                    <button type="button" className={styles.cancel} onClick={onClose}>Cancel</button>
                </div>

                <div className={styles.results}>
                    {showNoResults ? (
                        <div className={styles.empty}>No results for “{query.trim()}”</div>
                    ) : (
                        items.map((item, index) => {
                            const header = item.section !== lastSection ? item.section : null;
                            lastSection = item.section;
                            return (
                                <div key={item.key}>
                                    {header && <div className={styles.sectionLabel}>{header}</div>}
                                    <button
                                        type="button"
                                        className={cn(styles.item, index === activeIndex && styles.itemActive)}
                                        onMouseEnter={() => setActiveIndex(index)}
                                        onClick={() => open(item)}
                                    >
                                        <span className={styles.itemIcon}>{item.icon}</span>
                                        <span className={styles.itemBody}>
                                            <span className={styles.itemTitle}>{item.title}</span>
                                            <span className={styles.itemSubtitle}>{item.subtitle}</span>
                                        </span>
                                        {item.trailing && <span className={styles.itemTrailing}>{item.trailing}</span>}
                                        <CornerDownLeft size={15} className={styles.enter} />
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>

                <footer className={styles.footer}>
                    <span>↑↓ to navigate</span>
                    <span>↵ to open</span>
                    <span>esc to close</span>
                </footer>
            </motion.div>
        </motion.div>
    );
}
