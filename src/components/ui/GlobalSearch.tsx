'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Users, Receipt, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';

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

export default function GlobalSearch() {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResults>({ groups: [], transactions: [] });
    const [searching, setSearching] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (open && inputRef.current) inputRef.current.focus();
    }, [open]);

    // Keyboard shortcut: Ctrl+K or Cmd+K
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setOpen(prev => !prev);
            }
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const search = useCallback(async (q: string) => {
        if (q.length < 2) { setResults({ groups: [], transactions: [] }); return; }
        setSearching(true);
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            if (res.ok) setResults(await res.json());
        } catch { /* ignore */ }
        finally { setSearching(false); }
    }, []);

    const handleQueryChange = (val: string) => {
        setQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => search(val), 300);
    };

    const navigate = (path: string) => {
        setOpen(false);
        setQuery('');
        setResults({ groups: [], transactions: [] });
        router.push(path);
    };

    const hasResults = results.groups.length > 0 || results.transactions.length > 0;

    return (
        <>
            {/* Search trigger button */}
            <button
                onClick={() => setOpen(true)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', borderRadius: 'var(--radius-full)',
                    background: 'var(--bg-glass)', backdropFilter: 'blur(16px)',
                    border: '1px solid var(--border-glass)',
                    color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)',
                    cursor: 'pointer', transition: 'all 0.2s',
                    flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(var(--accent-500-rgb), 0.2)';
                    e.currentTarget.style.boxShadow = '0 0 12px rgba(var(--accent-500-rgb), 0.05)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-glass)';
                    e.currentTarget.style.boxShadow = 'none';
                }}
                title="Search (⌘K)"
            >
                <Search size={14} />
                <span className="search-label" style={{ display: 'none' }}>Search…</span>
                <kbd className="search-kbd" style={{
                    display: 'none', padding: '2px 6px', borderRadius: 4,
                    background: 'rgba(var(--accent-500-rgb), 0.06)',
                    border: '1px solid var(--border-glass)',
                    fontSize: '10px', fontWeight: 600, color: 'var(--fg-muted)',
                    fontFamily: 'inherit',
                }}>⌘K</kbd>
                <style>{`
                    @media (min-width: 640px) {
                        .search-label, .search-kbd { display: inline !important; }
                    }
                `}</style>
            </button>

            {/* Modal overlay */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed', inset: 0, zIndex: 9999,
                            background: 'rgba(0, 0, 0, 0.5)',
                            backdropFilter: 'blur(8px)',
                            display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
                            paddingTop: '15vh',
                        }}
                        onClick={() => setOpen(false)}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: -20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                width: '90%', maxWidth: 520,
                                background: 'var(--bg-elevated)',
                                borderRadius: 'var(--radius-2xl)',
                                border: '1px solid var(--border-glass)',
                                boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 40px rgba(var(--accent-500-rgb), 0.05)',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Search input */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                padding: 'var(--space-4)', borderBottom: '1px solid var(--border-default)',
                            }}>
                                {searching ? (
                                    <Loader2 size={18} style={{ color: 'var(--accent-400)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                                ) : (
                                    <Search size={18} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
                                )}
                                <input
                                    ref={inputRef}
                                    value={query}
                                    onChange={(e) => handleQueryChange(e.target.value)}
                                    placeholder="Search expenses, groups, members…"
                                    style={{
                                        flex: 1, background: 'none', border: 'none', outline: 'none',
                                        color: 'var(--fg-primary)', fontSize: 'var(--text-base)',
                                        fontWeight: 500,
                                    }}
                                />
                                {query && (
                                    <button onClick={() => { setQuery(''); setResults({ groups: [], transactions: [] }); }}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', padding: 4 }}>
                                        <X size={16} />
                                    </button>
                                )}
                            </div>

                            {/* Results */}
                            <div style={{ maxHeight: 400, overflowY: 'auto', padding: 'var(--space-2)' }}>
                                {query.length > 0 && !searching && !hasResults && (
                                    <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 'var(--text-sm)' }}>
                                        No results found for "{query}"
                                    </div>
                                )}

                                {query.length === 0 && (
                                    <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 'var(--text-sm)' }}>
                                        Start typing to search across all your groups and expenses
                                    </div>
                                )}

                                {/* Groups */}
                                {results.groups.length > 0 && (
                                    <div style={{ marginBottom: 'var(--space-2)' }}>
                                        <div style={{
                                            fontSize: '10px', fontWeight: 700, color: 'var(--fg-muted)',
                                            textTransform: 'uppercase', letterSpacing: '0.08em',
                                            padding: 'var(--space-2) var(--space-3)',
                                            display: 'flex', alignItems: 'center', gap: 4,
                                        }}>
                                            <Users size={11} /> Groups
                                        </div>
                                        {results.groups.map((g) => (
                                            <button
                                                key={g.id}
                                                onClick={() => navigate(`/groups/${g.id}`)}
                                                style={{
                                                    width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                                    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-lg)',
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    color: 'var(--fg-primary)', textAlign: 'left',
                                                    transition: 'all 0.15s',
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(var(--accent-500-rgb), 0.06)'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                                            >
                                                <span style={{ fontSize: '1.2rem' }}>{g.emoji}</span>
                                                <div>
                                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{g.name}</div>
                                                    <div style={{ fontSize: '10px', color: 'var(--fg-tertiary)' }}>
                                                        {g._count.members} member{g._count.members !== 1 ? 's' : ''}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* Transactions */}
                                {results.transactions.length > 0 && (
                                    <div>
                                        <div style={{
                                            fontSize: '10px', fontWeight: 700, color: 'var(--fg-muted)',
                                            textTransform: 'uppercase', letterSpacing: '0.08em',
                                            padding: 'var(--space-2) var(--space-3)',
                                            display: 'flex', alignItems: 'center', gap: 4,
                                        }}>
                                            <Receipt size={11} /> Expenses
                                        </div>
                                        {results.transactions.map((txn) => (
                                            <button
                                                key={txn.id}
                                                onClick={() => navigate(`/groups/${txn.trip.group.id}`)}
                                                style={{
                                                    width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                                    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-lg)',
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    color: 'var(--fg-primary)', textAlign: 'left',
                                                    transition: 'all 0.15s',
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(var(--accent-500-rgb), 0.06)'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                                            >
                                                <span style={{ fontSize: '1rem' }}>{txn.trip.group.emoji}</span>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {txn.title}
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: 'var(--fg-tertiary)' }}>
                                                        {txn.trip.group.name} · Paid by {txn.payer.name || 'Unknown'}
                                                    </div>
                                                </div>
                                                <div style={{
                                                    fontSize: 'var(--text-sm)', fontWeight: 700,
                                                    background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                                                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                                                    backgroundClip: 'text', flexShrink: 0,
                                                }}>
                                                    {formatCurrency(txn.amount)}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div style={{
                                padding: 'var(--space-2) var(--space-4)',
                                borderTop: '1px solid var(--border-default)',
                                display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)',
                                fontSize: '10px', color: 'var(--fg-muted)',
                            }}>
                                <span>↵ to select</span>
                                <span>esc to close</span>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
