'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Delete, Check, ChevronDown, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Avatar from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { CATEGORIES, PAYMENT_METHODS, formatCurrency, toPaise, cn } from '@/lib/utils';
import { z } from 'zod';
import styles from './quickadd.module.css';

interface GroupItem {
    id: string;
    name: string;
    emoji: string;
    members: { user: { id: string; name: string | null; image: string | null } }[];
}

export default function QuickAddPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const { user: currentUser, loading: userLoading } = useCurrentUser();

    // Data state
    const [groups, setGroups] = useState<GroupItem[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<string>('');
    const [activeTripId, setActiveTripId] = useState<string>('');
    const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
    const [loadingGroups, setLoadingGroups] = useState(true);

    // Form state
    const [amount, setAmount] = useState('');
    const [title, setTitle] = useState('');
    const [category, setCategory] = useState('general');
    const [method, setMethod] = useState('cash');
    const [payerId, setPayerId] = useState('');
    const [showCategories, setShowCategories] = useState(false);
    const [showPayers, setShowPayers] = useState(false);
    const [showMethods, setShowMethods] = useState(false);
    const [showGroups, setShowGroups] = useState(false);
    const [saving, setSaving] = useState(false);

    // Pre-fill from URL params (from scan page)
    useEffect(() => {
        const paramAmount = searchParams.get('amount');
        const paramTitle = searchParams.get('title');
        const paramMethod = searchParams.get('method');
        if (paramAmount) setAmount(paramAmount);
        if (paramTitle) setTitle(paramTitle);
        if (paramMethod) setMethod(paramMethod);
    }, [searchParams]);

    // Fetch groups on mount
    useEffect(() => {
        async function loadGroups() {
            try {
                const res = await fetch('/api/groups');
                if (res.ok) {
                    const data = await res.json();
                    setGroups(data);
                    if (data.length > 0) {
                        setSelectedGroupId(data[0].id);
                    }
                }
            } catch {
                // handle silently
            } finally {
                setLoadingGroups(false);
            }
        }
        loadGroups();
    }, []);

    // When group changes, fetch its detail (for trip ID and members)
    useEffect(() => {
        if (!selectedGroupId) return;
        async function loadGroupDetail() {
            try {
                const res = await fetch(`/api/groups/${selectedGroupId}`);
                if (res.ok) {
                    const data = await res.json();
                    // Get active trip
                    if (data.activeTrip) {
                        setActiveTripId(data.activeTrip.id);
                    }
                    // Set members from group
                    const memberList = (data.members || []).map((m: { user: { id: string; name: string | null } }) => ({
                        id: m.user.id,
                        name: m.user.name || 'Unknown',
                    }));
                    setMembers(memberList);
                    // Default payer to current user
                    if (currentUser && memberList.some((m: { id: string }) => m.id === currentUser.id)) {
                        setPayerId(currentUser.id);
                    } else if (memberList.length > 0) {
                        setPayerId(memberList[0].id);
                    }
                }
            } catch {
                // handle silently
            }
        }
        loadGroupDetail();
    }, [selectedGroupId, currentUser]);

    const numericAmount = parseFloat(amount) || 0;
    const splitPerPerson = members.length > 0
        ? formatCurrency(toPaise(numericAmount / members.length))
        : '₹0';

    const handleNumPad = useCallback((key: string) => {
        if (key === 'del') {
            setAmount((prev) => prev.slice(0, -1));
        } else if (key === '.') {
            if (!amount.includes('.')) {
                setAmount((prev) => (prev || '0') + '.');
            }
        } else {
            const parts = amount.split('.');
            if (parts[1] && parts[1].length >= 2) return;
            if (!parts[1] && parts[0] && parts[0].length >= 7) return;
            setAmount((prev) => {
                if (prev === '0' && key !== '.') return key;
                return prev + key;
            });
        }
        if (navigator.vibrate) navigator.vibrate(10);
    }, [amount]);

    const handleSave = async () => {
        // Client-side Zod validation
        const formSchema = z.object({
            title: z.string().min(1, 'Please add a description').max(200, 'Description too long'),
            amount: z.number().positive('Amount must be greater than zero'),
            tripId: z.string().min(1, 'Please select a group with an active trip'),
        });

        const result = formSchema.safeParse({
            title: title.trim(),
            amount: numericAmount,
            tripId: activeTripId,
        });

        if (!result.success) {
            const firstError = result.error.issues[0];
            toast(firstError.message, 'error');
            return;
        }

        setSaving(true);
        try {
            const res = await fetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tripId: activeTripId,
                    title: title.trim(),
                    amount: toPaise(numericAmount),
                    category,
                    method,
                    splitType: 'equal',
                }),
            });

            if (res.ok) {
                toast(`Expense added! ${formatCurrency(toPaise(numericAmount))} for "${title.trim()}"`, 'success');
                router.push('/transactions');
            } else {
                const err = await res.json().catch(() => ({}));
                toast(err.error || 'Failed to add expense', 'error');
            }
        } catch {
            toast('Network error — please check your connection', 'error');
        } finally {
            setSaving(false);
        }
    };

    const selectedGroup = groups.find(g => g.id === selectedGroupId);
    const payerMember = members.find(m => m.id === payerId);
    const payerDisplay = payerMember
        ? (payerMember.id === currentUser?.id ? `${payerMember.name} (You)` : payerMember.name)
        : 'Select';
    const catData = CATEGORIES[category];
    const methodData = PAYMENT_METHODS[method];

    if (loadingGroups || userLoading) {
        return (
            <div className={styles.quickAdd} style={{ alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-500)' }} />
            </div>
        );
    }

    if (groups.length === 0) {
        return (
            <div className={styles.quickAdd} style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 'var(--space-4)' }}>
                <div style={{ fontSize: '48px' }}>📋</div>
                <h3 style={{ color: 'var(--fg-primary)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
                    No groups yet
                </h3>
                <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-sm)' }}>
                    Create a group first to start adding expenses
                </p>
                <Button onClick={() => router.push('/groups')}>Go to Groups</Button>
            </div>
        );
    }

    return (
        <div className={styles.quickAdd}>
            {/* ── Group Selector Chip ── */}
            <div className={styles.metaRow} style={{ justifyContent: 'center' }}>
                <button className={cn(styles.chip, styles.chipActive)} onClick={() => setShowGroups(true)}>
                    <span>{selectedGroup?.emoji || '📋'}</span>
                    {selectedGroup?.name || 'Select Group'}
                    <ChevronDown size={14} />
                </button>
            </div>

            {/* ── Amount Display ── */}
            <div className={styles.amountDisplay}>
                <span className={styles.currencySign}>₹</span>
                <motion.div
                    className={cn(styles.amountValue, !amount && styles.placeholder)}
                    key={amount || 'placeholder'}
                    initial={{ scale: 0.95, opacity: 0.5 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                >
                    {amount || '0'}
                </motion.div>
            </div>

            {/* ── Title ── */}
            <input
                className={styles.titleInput}
                placeholder="What was this for?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
            />

            {/* ── Meta Row: Category / Payer / Method chips ── */}
            <div className={styles.metaRow}>
                <button className={cn(styles.chip)} onClick={() => setShowCategories(true)}>
                    <span>{catData.emoji}</span>
                    {catData.label}
                    <ChevronDown size={14} />
                </button>

                <button className={cn(styles.chip)} onClick={() => setShowPayers(true)}>
                    👤 {payerDisplay.split(' ')[0]}
                    <ChevronDown size={14} />
                </button>

                <button className={cn(styles.chip)} onClick={() => setShowMethods(true)}>
                    {methodData.emoji} {methodData.label}
                    <ChevronDown size={14} />
                </button>
            </div>

            {/* ── Split Info ── */}
            {numericAmount > 0 && members.length > 0 && (
                <motion.div
                    className={styles.splitInfo}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                >
                    Split equally: <span className={styles.splitAmount}>{splitPerPerson}</span> / person
                    ({members.length} people)
                </motion.div>
            )}

            {/* ── Numpad ── */}
            <div className={styles.numpad}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((key) => (
                    <motion.button
                        key={key}
                        className={cn(
                            styles.numKey,
                            key === 'del' && styles.numKeyDelete,
                        )}
                        whileTap={{ scale: 0.92 }}
                        onClick={() => handleNumPad(key)}
                    >
                        {key === 'del' ? <Delete size={22} /> : key}
                    </motion.button>
                ))}
            </div>

            {/* ── Submit ── */}
            <div className={styles.submitBtn}>
                <Button
                    fullWidth
                    size="lg"
                    disabled={!numericAmount || !title.trim() || !activeTripId}
                    loading={saving}
                    leftIcon={<Check size={18} />}
                    onClick={handleSave}
                >
                    Add Expense · {numericAmount > 0 ? formatCurrency(toPaise(numericAmount)) : '₹0'}
                </Button>
            </div>

            {/* ── Group Picker Modal ── */}
            <Modal
                isOpen={showGroups}
                onClose={() => setShowGroups(false)}
                title="Select Group"
                size="small"
            >
                <div className={styles.payerGrid}>
                    {groups.map((g) => (
                        <motion.button
                            key={g.id}
                            className={cn(
                                styles.payerItem,
                                selectedGroupId === g.id && styles.payerItemActive,
                            )}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => { setSelectedGroupId(g.id); setShowGroups(false); }}
                        >
                            <span style={{ fontSize: 24 }}>{g.emoji}</span>
                            <span className={styles.payerName}>{g.name}</span>
                            {selectedGroupId === g.id && (
                                <Check size={16} style={{ marginLeft: 'auto', color: 'var(--accent-500)' }} />
                            )}
                        </motion.button>
                    ))}
                </div>
            </Modal>

            {/* ── Category Picker Modal ── */}
            <Modal
                isOpen={showCategories}
                onClose={() => setShowCategories(false)}
                title="Category"
                size="small"
            >
                <div className={styles.categoryGrid}>
                    {Object.entries(CATEGORIES).map(([key, val]) => (
                        <motion.button
                            key={key}
                            className={cn(
                                styles.categoryItem,
                                category === key && styles.categoryItemActive,
                            )}
                            whileTap={{ scale: 0.93 }}
                            onClick={() => { setCategory(key); setShowCategories(false); }}
                        >
                            <span className={styles.categoryEmoji}>{val.emoji}</span>
                            <span className={styles.categoryLabel}>{val.label}</span>
                        </motion.button>
                    ))}
                </div>
            </Modal>

            {/* ── Payer Picker Modal ── */}
            <Modal
                isOpen={showPayers}
                onClose={() => setShowPayers(false)}
                title="Who paid?"
                size="small"
            >
                <div className={styles.payerGrid}>
                    {members.map((member) => (
                        <motion.button
                            key={member.id}
                            className={cn(
                                styles.payerItem,
                                payerId === member.id && styles.payerItemActive,
                            )}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => { setPayerId(member.id); setShowPayers(false); }}
                        >
                            <Avatar name={member.name} size="sm" />
                            <span className={styles.payerName}>
                                {member.id === currentUser?.id ? `${member.name} (You)` : member.name}
                            </span>
                            {payerId === member.id && (
                                <Check size={16} style={{ marginLeft: 'auto', color: 'var(--accent-500)' }} />
                            )}
                        </motion.button>
                    ))}
                </div>
            </Modal>

            {/* ── Method Picker Modal ── */}
            <Modal
                isOpen={showMethods}
                onClose={() => setShowMethods(false)}
                title="Payment Method"
                size="small"
            >
                <div className={styles.payerGrid}>
                    {Object.entries(PAYMENT_METHODS).map(([key, val]) => (
                        <motion.button
                            key={key}
                            className={cn(
                                styles.payerItem,
                                method === key && styles.payerItemActive,
                            )}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => { setMethod(key); setShowMethods(false); }}
                        >
                            <span style={{ fontSize: 24 }}>{val.emoji}</span>
                            <span className={styles.payerName}>{val.label}</span>
                            {method === key && (
                                <Check size={16} style={{ marginLeft: 'auto', color: 'var(--accent-500)' }} />
                            )}
                        </motion.button>
                    ))}
                </div>
            </Modal>
        </div>
    );
}
