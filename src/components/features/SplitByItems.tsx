'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, Check, Users, ShoppingBag, ChevronDown,
    ChevronUp, Receipt, Loader2, Sparkles,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';

/* ── Types ── */
interface ReceiptItem {
    name: string;
    quantity: number;
    price: number; // in paise
}

interface MemberInfo {
    id: string;
    name: string;
    image: string | null;
}

interface SplitByItemsProps {
    isOpen: boolean;
    onClose: () => void;
    items: ReceiptItem[];
    taxes: Record<string, number>; // e.g. { GST: 500 }
    subtotal: number;
    total: number;
    merchant: string | null;
    onCreateExpense: (splits: { userId: string; amount: number }[], title: string, total: number) => void;
}

/* ── Glass styles ── */
const glass: React.CSSProperties = {
    background: 'var(--bg-glass)',
    backdropFilter: 'blur(24px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
    border: '1px solid var(--border-glass)',
};

export default function SplitByItems({
    isOpen, onClose, items, taxes, subtotal, total, merchant, onCreateExpense,
}: SplitByItemsProps) {
    const [members, setMembers] = useState<MemberInfo[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(true);
    // For each item index → set of member IDs who had that item
    const [assignments, setAssignments] = useState<Record<number, Set<string>>>({});
    const [expandedItem, setExpandedItem] = useState<number | null>(null);
    const [creating, setCreating] = useState(false);

    // Fetch group members
    useEffect(() => {
        if (!isOpen) return;
        (async () => {
            try {
                const res = await fetch('/api/groups');
                if (!res.ok) return;
                const groups = await res.json();
                if (!Array.isArray(groups) || groups.length === 0) return;

                const memberMap = new Map<string, MemberInfo>();
                for (const g of groups) {
                    if (g.members) {
                        for (const m of g.members) {
                            const id = m.userId || m.user?.id;
                            if (id && !memberMap.has(id)) {
                                memberMap.set(id, {
                                    id,
                                    name: m.user?.name || m.name || 'Unknown',
                                    image: m.user?.image || null,
                                });
                            }
                        }
                    }
                }
                const memberList = Array.from(memberMap.values());
                setMembers(memberList);

                // Default: all items assigned to all members
                const defaultAssign: Record<number, Set<string>> = {};
                items.forEach((_, idx) => {
                    defaultAssign[idx] = new Set(memberList.map(m => m.id));
                });
                setAssignments(defaultAssign);
            } catch (e) {
                console.error('Failed to fetch members:', e);
            } finally {
                setLoadingMembers(false);
            }
        })();
    }, [isOpen, items]);

    // Toggle a member assignment for an item
    const toggleAssignment = (itemIdx: number, memberId: string) => {
        setAssignments(prev => {
            const updated = { ...prev };
            const set = new Set(updated[itemIdx] || []);
            if (set.has(memberId)) set.delete(memberId);
            else set.add(memberId);
            updated[itemIdx] = set;
            return updated;
        });
    };

    // Select/deselect all members for an item
    const toggleAll = (itemIdx: number) => {
        setAssignments(prev => {
            const updated = { ...prev };
            const current = updated[itemIdx] || new Set();
            if (current.size === members.length) {
                updated[itemIdx] = new Set();
            } else {
                updated[itemIdx] = new Set(members.map(m => m.id));
            }
            return updated;
        });
    };

    // Compute per-person totals
    const perPersonTotals = useMemo(() => {
        const totals: Record<string, number> = {};
        members.forEach(m => { totals[m.id] = 0; });

        // Sum item-level splits
        let assignedSubtotal = 0;
        items.forEach((item, idx) => {
            const assigned = assignments[idx];
            if (!assigned || assigned.size === 0) return;
            const perPerson = Math.round(item.price / assigned.size);
            assigned.forEach(id => {
                totals[id] = (totals[id] || 0) + perPerson;
            });
            assignedSubtotal += item.price;
        });

        // Distribute taxes proportionally based on item-level share
        const totalTax = Object.values(taxes).reduce((s, v) => s + v, 0);
        if (assignedSubtotal > 0 && totalTax > 0) {
            for (const memberId of Object.keys(totals)) {
                if (totals[memberId] > 0) {
                    const proportion = totals[memberId] / assignedSubtotal;
                    totals[memberId] += Math.round(totalTax * proportion);
                }
            }
        }

        return totals;
    }, [assignments, items, taxes, members]);

    const grandTotal = Object.values(perPersonTotals).reduce((s, v) => s + v, 0);
    const unassignedItems = items.filter((_, idx) => !assignments[idx] || assignments[idx].size === 0);

    const handleCreate = async () => {
        if (unassignedItems.length > 0) return;
        setCreating(true);
        const splits = Object.entries(perPersonTotals)
            .filter(([, amount]) => amount > 0)
            .map(([userId, amount]) => ({ userId, amount }));
        onCreateExpense(splits, merchant || 'Receipt expense', grandTotal);
        setCreating(false);
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'transparent', // No visible backdrop
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                }}
                onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            >
                <motion.div
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                    style={{
                        width: '100%', maxWidth: 500,
                        height: '85vh', // Decreased from 92vh to avoid overlap
                        borderRadius: '28px 28px 0 0',
                        background: 'var(--bg-primary)',
                        boxShadow: '0 -10px 40px rgba(0,0,0,0.08)',
                        display: 'flex', flexDirection: 'column',
                        overflow: 'hidden',
                        position: 'relative',
                    }}
                >
                    {/* ── Handle Bar ── */}
                    <div style={{
                        display: 'flex', justifyContent: 'center', padding: '16px 0 8px',
                        background: 'var(--bg-primary)', flexShrink: 0,
                        cursor: 'grab'
                    }} onClick={onClose}>
                        <div style={{
                            width: 36, height: 4, borderRadius: 2,
                            background: 'var(--border-tertiary)',
                        }} />
                    </div>

                    {/* ── Header ── */}
                    <div style={{
                        padding: '0 24px 20px',
                        borderBottom: '1px solid var(--border-secondary)',
                        flexShrink: 0, background: 'var(--bg-primary)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <h3 style={{
                                    margin: 0, fontSize: '24px', fontWeight: 800,
                                    color: 'var(--fg-primary)', letterSpacing: '-0.02em',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                }}>
                                    Split Items
                                    <span style={{
                                        fontSize: '12px', fontWeight: 600, color: 'var(--accent-500)',
                                        background: 'rgba(var(--accent-500-rgb), 0.1)',
                                        padding: '2px 8px', borderRadius: '12px'
                                    }}>
                                        {items.length}
                                    </span>
                                </h3>
                                {merchant && (
                                    <p style={{
                                        margin: '4px 0 0', fontSize: '14px',
                                        color: 'var(--fg-tertiary)', fontWeight: 500
                                    }}>
                                        {merchant}
                                    </p>
                                )}
                            </div>

                            <button onClick={onClose} style={{
                                background: 'var(--surface-primary)',
                                border: '1px solid var(--border-secondary)',
                                borderRadius: '50%',
                                width: 36, height: 36, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: 'var(--fg-secondary)', transition: 'all 0.2s'
                            }}>
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    {/* ── Content ── */}
                    <div style={{
                        flex: 1, overflowY: 'auto', padding: '20px 20px 40px',
                        display: 'flex', flexDirection: 'column', gap: 20,
                        background: 'var(--bg-primary)', // Keeping it seamless with header
                        WebkitOverflowScrolling: 'touch', // Smooth scroll on iOS
                        scrollBehavior: 'smooth',
                    }}>
                        {loadingMembers ? (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                height: 200, color: 'var(--fg-tertiary)', flexDirection: 'column', gap: 16
                            }}>
                                <Loader2 size={32} className="animate-spin" style={{ opacity: 0.5 }} />
                                <span style={{ fontSize: '14px', fontWeight: 500 }}>Loading group...</span>
                            </div>
                        ) : (
                            <>
                                {/* ── Member Legend (Horizontal Scroll) ── */}
                                <div>
                                    <div style={{
                                        fontSize: '13px', fontWeight: 600, color: 'var(--fg-tertiary)',
                                        marginBottom: 12, paddingLeft: 0, textTransform: 'uppercase', letterSpacing: '0.04em',
                                        textAlign: 'center'
                                    }}>
                                        Who's involved?
                                    </div>
                                    <div style={{
                                        display: 'flex', gap: 16, overflowX: 'auto',
                                        padding: '4px 4px 16px', scrollbarWidth: 'none',
                                        margin: '0 -4px',
                                        justifyContent: 'center',
                                        WebkitOverflowScrolling: 'touch',
                                    }}>
                                        {members.map(m => (
                                            <div key={m.id} style={{
                                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                                                minWidth: 64, cursor: 'default'
                                            }}>
                                                <div style={{
                                                    padding: 3, background: 'var(--bg-primary)',
                                                    borderRadius: '50%', boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                                                }}>
                                                    <Avatar name={m.name} image={m.image} size="md" />
                                                </div>
                                                <span style={{
                                                    fontSize: '12px', color: 'var(--fg-secondary)', fontWeight: 500,
                                                    maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    textAlign: 'center'
                                                }}>
                                                    {m.name.split(' ')[0]}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* ── Item List ── */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    <div style={{
                                        fontSize: '13px', fontWeight: 600, color: 'var(--fg-tertiary)',
                                        paddingLeft: 4, textTransform: 'uppercase', letterSpacing: '0.04em'
                                    }}>
                                        Receipt Items
                                    </div>

                                    {items.map((item, idx) => {
                                        const assigned = assignments[idx] || new Set();
                                        const isExpanded = expandedItem === idx;
                                        const allSelected = assigned.size === members.length;

                                        return (
                                            <motion.div
                                                key={idx}
                                                layout
                                                initial={false}
                                                animate={{
                                                    backgroundColor: isExpanded ? 'var(--surface-primary)' : 'var(--bg-primary)',
                                                    scale: isExpanded ? 1.02 : 1,
                                                    boxShadow: isExpanded ? '0 8px 24px rgba(0,0,0,0.06)' : 'none'
                                                }}
                                                style={{
                                                    borderRadius: '20px',
                                                    border: isExpanded ? '1px solid transparent' : '1px solid var(--border-secondary)',
                                                    overflow: 'hidden',
                                                    position: 'relative', zIndex: isExpanded ? 10 : 0
                                                }}
                                            >
                                                {/* Item Row */}
                                                <button
                                                    onClick={() => setExpandedItem(isExpanded ? null : idx)}
                                                    style={{
                                                        width: '100%', border: 'none', background: 'none',
                                                        cursor: 'pointer', padding: '16px 20px',
                                                        display: 'flex', alignItems: 'center', gap: 16,
                                                        textAlign: 'left',
                                                    }}
                                                >
                                                    {/* Status Icon */}
                                                    <div style={{
                                                        width: 40, height: 40, borderRadius: '12px',
                                                        background: assigned.size > 0 ? 'rgba(var(--accent-500-rgb), 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        color: assigned.size > 0 ? 'var(--accent-500)' : 'var(--color-error)',
                                                        flexShrink: 0
                                                    }}>
                                                        <ShoppingBag size={20} />
                                                    </div>

                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            fontSize: '16px', fontWeight: 600,
                                                            color: 'var(--fg-primary)', lineHeight: 1.3,
                                                            marginBottom: 4,
                                                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                                        }}>
                                                            {item.name}
                                                        </div>

                                                        <div style={{
                                                            fontSize: '13px', color: 'var(--fg-secondary)',
                                                            display: 'flex', alignItems: 'center', gap: 6
                                                        }}>
                                                            {assigned.size === 0 ? (
                                                                <span style={{ color: 'var(--color-error)' }}>Assign to someone</span>
                                                            ) : (
                                                                <>
                                                                    <span style={{ fontWeight: 500 }}>{formatCurrency(Math.round(item.price / assigned.size))}</span>
                                                                    <span style={{ color: 'var(--fg-tertiary)' }}>per {assigned.size > 1 ? 'person' : 'person'}</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--fg-primary)' }}>
                                                            {formatCurrency(item.price)}
                                                        </div>
                                                        {item.quantity > 1 && (
                                                            <div style={{ fontSize: '11px', color: 'var(--fg-tertiary)', marginTop: 2 }}>
                                                                Qty: {item.quantity}
                                                            </div>
                                                        )}
                                                    </div>
                                                </button>

                                                {/* Expanded Selection Grid */}
                                                <AnimatePresence>
                                                    {isExpanded && (
                                                        <motion.div
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: 'auto', opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            style={{ overflow: 'hidden' }}
                                                        >
                                                            <div style={{
                                                                padding: '0 20px 24px',
                                                            }}>
                                                                {/* Divider */}
                                                                <div style={{ height: 1, background: 'var(--border-secondary)', marginBottom: 16, opacity: 0.5 }} />

                                                                <div style={{
                                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                                    marginBottom: 16
                                                                }}>
                                                                    <span style={{ fontSize: '13px', color: 'var(--fg-tertiary)', fontWeight: 500 }}>
                                                                        Split between:
                                                                    </span>
                                                                    <button
                                                                        onClick={() => toggleAll(idx)}
                                                                        style={{
                                                                            background: 'none', border: 'none',
                                                                            color: 'var(--accent-500)', fontSize: '13px', fontWeight: 600,
                                                                            cursor: 'pointer', padding: '4px 8px'
                                                                        }}
                                                                    >
                                                                        {allSelected ? 'Deselect All' : 'Select All'}
                                                                    </button>
                                                                </div>

                                                                <div style={{
                                                                    display: 'grid',
                                                                    gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
                                                                    gap: 12,
                                                                }}>
                                                                    {members.map(m => {
                                                                        const selected = assigned.has(m.id);
                                                                        return (
                                                                            <button
                                                                                key={m.id}
                                                                                onClick={() => toggleAssignment(idx, m.id)}
                                                                                style={{
                                                                                    background: 'none', border: 'none',
                                                                                    display: 'flex', flexDirection: 'column',
                                                                                    alignItems: 'center', gap: 8, cursor: 'pointer',
                                                                                    opacity: selected ? 1 : 0.5,
                                                                                    transform: selected ? 'scale(1)' : 'scale(0.95)',
                                                                                    transition: 'all 0.2s'
                                                                                }}
                                                                            >
                                                                                <div style={{ position: 'relative' }}>
                                                                                    <Avatar name={m.name} image={m.image} size="lg" ring={selected} />
                                                                                    {selected && (
                                                                                        <motion.div
                                                                                            initial={{ scale: 0 }} animate={{ scale: 1 }}
                                                                                            style={{
                                                                                                position: 'absolute', bottom: 0, right: -2,
                                                                                                background: 'var(--accent-500)',
                                                                                                color: 'white', borderRadius: '50%',
                                                                                                width: 20, height: 20,
                                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                                border: '2px solid var(--bg-primary)'
                                                                                            }}
                                                                                        >
                                                                                            <Check size={12} strokeWidth={3} />
                                                                                        </motion.div>
                                                                                    )}
                                                                                </div>
                                                                                <span style={{
                                                                                    fontSize: '11px',
                                                                                    color: selected ? 'var(--fg-primary)' : 'var(--fg-tertiary)',
                                                                                    fontWeight: selected ? 600 : 500,
                                                                                    textAlign: 'center'
                                                                                }}>
                                                                                    {m.name.split(' ')[0]}
                                                                                </span>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </motion.div>
                                        );
                                    })}
                                </div>

                                {/* ── Taxes ── */}
                                {Object.keys(taxes).length > 0 && (
                                    <div style={{
                                        background: 'var(--surface-primary)',
                                        borderRadius: '20px', padding: '20px',
                                        marginTop: 8, border: '1px dashed var(--border-secondary)'
                                    }}>
                                        <div style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            marginBottom: 12
                                        }}>
                                            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-secondary)' }}>
                                                Taxes & Extras
                                            </span>
                                            <span style={{ fontSize: '11px', color: 'var(--fg-tertiary)', background: 'var(--surface-secondary)', padding: '2px 8px', borderRadius: '6px' }}>
                                                Proportional Split
                                            </span>
                                        </div>
                                        {Object.entries(taxes).map(([name, amount]) => (
                                            <div key={name} style={{
                                                display: 'flex', justifyContent: 'space-between',
                                                fontSize: '14px', color: 'var(--fg-secondary)',
                                                marginBottom: 8
                                            }}>
                                                <span>{name}</span>
                                                <span style={{ fontWeight: 500 }}>{formatCurrency(amount)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div style={{ height: 60 }} /> {/* Spacer for bottom scroll */}
                            </>
                        )}
                    </div>

                    {/* ── Footer ── */}
                    <AnimatePresence>
                        {!loadingMembers && (
                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                style={{
                                    padding: '20px 24px 32px',
                                    background: 'var(--bg-primary)',
                                    borderTop: '1px solid var(--border-secondary)',
                                    boxShadow: '0 -8px 32px rgba(0,0,0,0.03)',
                                    flexShrink: 0, zIndex: 20
                                }}
                            >
                                {/* Payer Breakdown Bubbles */}
                                <div style={{
                                    display: 'flex', gap: 8, overflowX: 'auto',
                                    paddingBottom: 20, marginBottom: 8, scrollbarWidth: 'none',
                                    WebkitOverflowScrolling: 'touch',
                                }}>
                                    {members.map(m => {
                                        const amount = perPersonTotals[m.id] || 0;
                                        if (amount === 0) return null;
                                        return (
                                            <div key={m.id} style={{
                                                display: 'flex', alignItems: 'center', gap: 8,
                                                padding: '4px 12px 4px 4px',
                                                background: 'var(--surface-secondary)',
                                                borderRadius: '24px',
                                                flexShrink: 0,
                                                border: '1px solid var(--border-secondary)'
                                            }}>
                                                <Avatar name={m.name} image={m.image} size="xs" />
                                                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-primary)' }}>
                                                    {formatCurrency(amount)}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Summary Bar */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontSize: '13px', color: 'var(--fg-tertiary)', fontWeight: 500 }}>
                                                Total to Split
                                            </span>
                                            {/* Info Tooltip Trigger (could be added here if we had a tooltip component) */}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                                            <span style={{ fontSize: '32px', fontWeight: 800, color: 'var(--fg-primary)', lineHeight: 1 }}>
                                                {formatCurrency(grandTotal)}
                                            </span>
                                        </div>

                                        {Math.abs(grandTotal - total) >= 2 && (
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 6, marginTop: 4,
                                                color: 'var(--fg-tertiary)', fontSize: '13px'
                                            }}>
                                                <span>Original Receipt:</span>
                                                <span style={{
                                                    fontWeight: 600, color: 'var(--fg-secondary)',
                                                    textDecoration: 'line-through', opacity: 0.7
                                                }}>
                                                    {formatCurrency(total)}
                                                </span>
                                                <span style={{ color: 'var(--color-warning)', fontSize: '12px', fontWeight: 600, background: 'rgba(245, 158, 11, 0.1)', padding: '1px 6px', borderRadius: 4 }}>
                                                    Mismatch
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <Button
                                    fullWidth
                                    size="lg"
                                    disabled={unassignedItems.length > 0 || creating}
                                    loading={creating}
                                    onClick={handleCreate}
                                    style={{
                                        height: 56,
                                        borderRadius: '16px',
                                        fontSize: '16px',
                                        background: unassignedItems.length > 0 ? 'var(--bg-muted)' : 'var(--accent-500)',
                                        color: 'white',
                                        boxShadow: unassignedItems.length > 0 ? 'none' : '0 8px 24px rgba(var(--accent-500-rgb), 0.3)'
                                    }}
                                >
                                    {unassignedItems.length > 0
                                        ? `${unassignedItems.length} Unassigned Items`
                                        : 'Create Expense'}
                                </Button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
