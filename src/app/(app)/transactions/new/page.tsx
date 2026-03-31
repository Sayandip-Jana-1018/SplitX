'use client';

import { useState, useCallback, useEffect, useRef, Suspense, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Delete, Check, ChevronDown, Loader2, Mic, Plus, Minus, Equal, AlertTriangle, History, TrendingUp } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Avatar from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';
import { PaymentIcon } from '@/components/ui/Icons';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { CATEGORIES, PAYMENT_METHODS, formatCurrency, toPaise, cn, getCategoryData } from '@/lib/utils';

import styles from './quickadd.module.css';
import VoiceInput from '@/components/features/VoiceInput';
import type { VoiceParseResult } from '@/components/features/VoiceInput';

interface GroupItem {
    id: string;
    name: string;
    emoji: string;
    members: { user: { id: string; name: string | null; image: string | null } }[];
}

interface RecentTransaction {
    id: string;
    title: string;
    amount: number;
    createdAt: string;
    payer: { id: string; name: string | null };
}

const EXPENSE_DRAFT_KEY = 'splitx:add-expense-draft:v1';
const RECENT_GROUPS_KEY = 'splitx:recent-groups:v1';
const RECENT_PAYERS_KEY = 'splitx:recent-payers:v1';

function QuickAddContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const { user: currentUser, loading: userLoading } = useCurrentUser();

    // Data state
    const [groups, setGroups] = useState<GroupItem[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<string>('');
    const [activeTripId, setActiveTripId] = useState<string>('');
    const [members, setMembers] = useState<{ id: string; name: string; image?: string | null }[]>([]);
    const [loadingGroups, setLoadingGroups] = useState(true);
    const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);
    const [recentGroupIds, setRecentGroupIds] = useState<string[]>([]);
    const [recentPayersByGroup, setRecentPayersByGroup] = useState<Record<string, string[]>>({});
    const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

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
    const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

    // Custom Category State
    const [isCustomCategory, setIsCustomCategory] = useState(false);
    const [customCatValue, setCustomCatValue] = useState('');

    // Custom split state
    const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
    const [customSplits, setCustomSplits] = useState<{ userId: string; amount: number }[]>([]);

    // Flag to prevent useEffect from resetting members after voice input
    const voiceAppliedRef = useRef(false);
    const restoredDraftRef = useRef(false);

    // Calculator expression state
    const [expression, setExpression] = useState('');
    const amountInputRef = useRef<HTMLInputElement>(null);

    /** Evaluate a simple expression with + and - only, left-to-right */
    const evaluateExpression = useCallback((expr: string): number => {
        const sanitized = expr.replace(/[^\d.+\-]/g, '').replace(/^[+\-]/, '');
        if (!sanitized) return 0;
        const tokens = sanitized.split(/(?=[+\-])|(?<=[+\-])/).filter(t => t.trim());
        let total = 0;
        let op = '+';
        for (const tok of tokens) {
            const trimmed = tok.trim();
            if (trimmed === '+' || trimmed === '-') { op = trimmed; continue; }
            const num = parseFloat(trimmed);
            if (isNaN(num)) continue;
            total = op === '+' ? total + num : total - num;
        }
        return Math.max(0, Math.round(total * 100) / 100);
    }, []);

    const hasOperator = expression.includes('+') || expression.includes('-');

    // Pre-fill from URL params (from scan page)
    useEffect(() => {
        const paramAmount = searchParams.get('amount');
        const paramTitle = searchParams.get('title');
        const paramMethod = searchParams.get('method');
        const paramSplitData = searchParams.get('splitData');
        if (paramAmount) setAmount(paramAmount);
        if (paramTitle) setTitle(paramTitle);
        if (paramMethod) setMethod(paramMethod);

        if (paramSplitData) {
            try {
                const splits = JSON.parse(paramSplitData);
                if (Array.isArray(splits) && splits.length > 0) {
                    setCustomSplits(splits);
                    setSplitType('custom');
                    // Sync selected members with the custom split
                    const memberIds = new Set(splits.map((s: { userId: string }) => s.userId));
                    setSelectedMembers(memberIds);
                }
            } catch (e) {
                console.error("Failed to parse split data", e);
            }
        }
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

    useEffect(() => {
        try {
            const storedGroups = window.localStorage.getItem(RECENT_GROUPS_KEY);
            const storedPayers = window.localStorage.getItem(RECENT_PAYERS_KEY);
            if (storedGroups) {
                setRecentGroupIds(JSON.parse(storedGroups));
            }
            if (storedPayers) {
                setRecentPayersByGroup(JSON.parse(storedPayers));
            }
        } catch {
            // Ignore malformed local data
        }
    }, []);

    useEffect(() => {
        if (loadingGroups || restoredDraftRef.current || groups.length === 0) return;

        const hasUrlPrefill =
            searchParams.has('amount') ||
            searchParams.has('title') ||
            searchParams.has('method') ||
            searchParams.has('splitData') ||
            searchParams.has('receiptUrl');

        restoredDraftRef.current = true;
        if (hasUrlPrefill) return;

        try {
            const rawDraft = window.localStorage.getItem(EXPENSE_DRAFT_KEY);
            if (!rawDraft) return;

            const draft = JSON.parse(rawDraft) as {
                selectedGroupId?: string;
                amount?: string;
                title?: string;
                category?: string;
                method?: string;
                payerId?: string;
                splitType?: 'equal' | 'custom';
                selectedMemberIds?: string[];
                customSplits?: { userId: string; amount: number }[];
            };

            if (draft.selectedGroupId && groups.some((group) => group.id === draft.selectedGroupId)) {
                setSelectedGroupId(draft.selectedGroupId);
            }
            if (draft.amount) setAmount(draft.amount);
            if (draft.title) setTitle(draft.title);
            if (draft.category) setCategory(draft.category);
            if (draft.method) setMethod(draft.method);
            if (draft.payerId) setPayerId(draft.payerId);
            if (draft.splitType) setSplitType(draft.splitType);
            if (draft.selectedMemberIds?.length) {
                setSelectedMembers(new Set(draft.selectedMemberIds));
            }
            if (draft.customSplits?.length) {
                setCustomSplits(draft.customSplits);
            }
        } catch {
            // Ignore malformed drafts
        }
    }, [groups, loadingGroups, searchParams]);

    useEffect(() => {
        if (loadingGroups || !selectedGroupId) return;

        const draft = {
            selectedGroupId,
            amount,
            title,
            category,
            method,
            payerId,
            splitType,
            selectedMemberIds: Array.from(selectedMembers),
            customSplits,
            savedAt: new Date().toISOString(),
        };

        try {
            window.localStorage.setItem(EXPENSE_DRAFT_KEY, JSON.stringify(draft));
        } catch {
            // Ignore storage errors
        }
    }, [
        amount,
        category,
        customSplits,
        loadingGroups,
        method,
        payerId,
        selectedGroupId,
        selectedMembers,
        splitType,
        title,
    ]);

    useEffect(() => {
        if (!selectedGroupId) return;
        async function loadGroupDetail() {
            try {
                const res = await fetch(`/api/groups/${selectedGroupId}`);
                if (res.ok) {
                    const data = await res.json();
                    // Get active trip — if none, auto-create one
                    if (data.activeTrip) {
                        setActiveTripId(data.activeTrip.id);
                    } else {
                        // Auto-create a default trip for this group
                        try {
                            const tripRes = await fetch('/api/trips', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    groupId: selectedGroupId,
                                    title: 'General',
                                }),
                            });
                            if (tripRes.ok) {
                                const trip = await tripRes.json();
                                setActiveTripId(trip.id);
                            }
                        } catch { /* silently fail */ }
                    }
                    // Set members from group
                    const memberList = (data.members || []).map((m: { user: { id: string; name: string | null; image?: string | null } }) => ({
                        id: m.user.id,
                        name: m.user.name || 'Unknown',
                        image: m.user.image || null,
                    }));
                    setMembers(memberList);

                    // Skip default selections if voice input was just applied
                    if (voiceAppliedRef.current) {
                        voiceAppliedRef.current = false;
                    } else {
                        // Default member selection
                        if (splitType !== 'custom') {
                            setSelectedMembers(new Set(memberList.map((m: { id: string }) => m.id)));
                        } else if (customSplits.length > 0) {
                            setSelectedMembers(new Set(customSplits.map(s => s.userId)));
                        }

                        // Default payer to current user
                        if (currentUser && memberList.some((m: { id: string }) => m.id === currentUser.id)) {
                            setPayerId(currentUser.id);
                        } else if (memberList.length > 0) {
                            setPayerId(memberList[0].id);
                        }
                    }
                }
            } catch {
                // handle silently
            }
        }
        loadGroupDetail();
    }, [selectedGroupId, currentUser, splitType, customSplits]);

    useEffect(() => {
        if (!selectedGroupId) return;

        setRecentGroupIds((prev) => {
            const next = [selectedGroupId, ...prev.filter((groupId) => groupId !== selectedGroupId)].slice(0, 3);
            try {
                window.localStorage.setItem(RECENT_GROUPS_KEY, JSON.stringify(next));
            } catch {
                // Ignore storage errors
            }
            return next;
        });
    }, [selectedGroupId]);

    useEffect(() => {
        if (!selectedGroupId || !payerId) return;

        setRecentPayersByGroup((prev) => {
            const existing = prev[selectedGroupId] || [];
            const nextForGroup = [payerId, ...existing.filter((id) => id !== payerId)].slice(0, 3);
            const next = { ...prev, [selectedGroupId]: nextForGroup };
            try {
                window.localStorage.setItem(RECENT_PAYERS_KEY, JSON.stringify(next));
            } catch {
                // Ignore storage errors
            }
            return next;
        });
    }, [payerId, selectedGroupId]);

    useEffect(() => {
        if (!activeTripId) {
            setRecentTransactions([]);
            return;
        }

        let cancelled = false;
        async function loadRecentTransactions() {
            try {
                const res = await fetch(`/api/transactions?tripId=${activeTripId}&limit=20`);
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled) {
                    setRecentTransactions(Array.isArray(data) ? data : []);
                }
            } catch {
                if (!cancelled) {
                    setRecentTransactions([]);
                }
            }
        }

        loadRecentTransactions();
        return () => {
            cancelled = true;
        };
    }, [activeTripId]);

    const numericAmount = parseFloat(amount) || 0;
    const selectedCount = selectedMembers.size;
    const splitPerPerson = selectedCount > 0
        ? formatCurrency(toPaise(numericAmount / selectedCount))
        : '₹0';

    // Calculate custom amount for a member if custom split is active
    const getMemberAmount = (memberId: string) => {
        if (splitType !== 'custom') return null;
        const split = customSplits.find(s => s.userId === memberId);
        return split ? formatCurrency(split.amount) : '₹0';
    };

    const toggleMember = useCallback((memberId: string) => {
        // Compute new member set from current value (not inside updater to avoid nested setState)
        const next = new Set(selectedMembers);
        if (next.has(memberId)) {
            if (next.size <= 1) return;
            next.delete(memberId);
        } else {
            next.add(memberId);
        }

        // Set both states at the same level so React batches them together
        setSelectedMembers(next);

        if (splitType === 'custom') {
            const totalPaise = toPaise(numericAmount);
            const memberArr = Array.from(next);
            const perPerson = Math.floor(totalPaise / memberArr.length);
            const remainder = totalPaise - perPerson * memberArr.length;
            setCustomSplits(memberArr.map((id, i) => ({
                userId: id,
                amount: perPerson + (i === memberArr.length - 1 ? remainder : 0),
            })));
        }
    }, [selectedMembers, splitType, numericAmount]);

    const handleNumPad = useCallback((key: string) => {
        if (key === 'del') {
            setExpression(prev => prev.slice(0, -1));
            setAmount(prev => {
                const newExpr = (expression || prev).slice(0, -1);
                // If expression still has operators, don't update amount yet
                if (newExpr.includes('+') || newExpr.includes('-')) return prev;
                return newExpr;
            });
        } else if (key === '+' || key === '-') {
            // Don't allow operators at the start or consecutive operators
            if (!expression && !amount) return;
            const base = expression || amount;
            const last = base.charAt(base.length - 1);
            if (last === '+' || last === '-' || last === '.') return;
            setExpression(base + key);
        } else if (key === '=') {
            // Evaluate the expression
            const expr = expression || amount;
            if (!expr) return;
            const result = evaluateExpression(expr);
            const resultStr = result % 1 === 0 ? result.toString() : result.toFixed(2);
            setAmount(resultStr);
            setExpression('');
        } else if (key === '.') {
            const base = expression || amount;
            // Find the last number segment (after last operator)
            const lastOpIdx = Math.max(base.lastIndexOf('+'), base.lastIndexOf('-'));
            const lastSegment = lastOpIdx >= 0 ? base.substring(lastOpIdx + 1) : base;
            if (lastSegment.includes('.')) return;
            const newVal = (base || '0') + '.';
            if (expression) setExpression(newVal);
            else setAmount(newVal);
        } else {
            // Digit
            const base = expression || amount;
            const lastOpIdx = Math.max(base.lastIndexOf('+'), base.lastIndexOf('-'));
            const lastSegment = lastOpIdx >= 0 ? base.substring(lastOpIdx + 1) : base;
            const parts = lastSegment.split('.');
            if (parts[1] && parts[1].length >= 2) return;
            if (!parts[1] && parts[0] && parts[0].length >= 7) return;
            const newVal = (() => {
                if (!base && key === '0') return '0';
                if (base === '0' && key !== '.') return key;
                return base + key;
            })();
            if (expression) setExpression(newVal);
            else setAmount(newVal);
        }
        if (navigator.vibrate) navigator.vibrate(10);
    }, [amount, expression, evaluateExpression]);

    /** Handle keyboard input in the amount field */
    const handleAmountInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        // Allow digits, decimal, +, -
        const cleaned = raw.replace(/[^\d.+\-]/g, '');
        if (cleaned.includes('+') || cleaned.includes('-')) {
            setExpression(cleaned);
        } else {
            setExpression('');
            setAmount(cleaned);
        }
    }, []);

    const catData = getCategoryData(category);
    const effectiveTitle = title.trim() || catData.label;
    const selectedMemberIds = useMemo(
        () => members.filter((member) => selectedMembers.has(member.id)).map((member) => member.id),
        [members, selectedMembers]
    );
    const totalPaise = toPaise(numericAmount);

    const impactPreview = useMemo(() => {
        if (!numericAmount || selectedMemberIds.length === 0) return [];

        const equalPerPerson = selectedMemberIds.length > 0 ? Math.floor(totalPaise / selectedMemberIds.length) : 0;
        const equalRemainder = totalPaise - equalPerPerson * selectedMemberIds.length;

        return selectedMemberIds
            .map((memberId, index) => {
                const member = members.find((item) => item.id === memberId);
                if (!member) return null;

                const share = splitType === 'custom'
                    ? customSplits.find((split) => split.userId === memberId)?.amount || 0
                    : equalPerPerson + (index === 0 ? equalRemainder : 0);

                const delta = (memberId === payerId ? totalPaise : 0) - share;
                return {
                    memberId,
                    name: memberId === currentUser?.id ? 'You' : member.name.split(' ')[0],
                    delta,
                };
            })
            .filter((entry): entry is { memberId: string; name: string; delta: number } => Boolean(entry));
    }, [currentUser?.id, customSplits, members, numericAmount, payerId, selectedMemberIds, splitType, totalPaise]);

    const duplicateCandidates = useMemo(() => {
        if (!effectiveTitle || !numericAmount) return [];

        const normalizedTitle = effectiveTitle.toLowerCase().trim();
        const now = Date.now();

        return recentTransactions.filter((transaction) => {
            const titleMatches = transaction.title.toLowerCase().trim() === normalizedTitle;
            const amountMatches = transaction.amount === totalPaise;
            const withinWindow = now - new Date(transaction.createdAt).getTime() <= 3 * 24 * 60 * 60 * 1000;
            return titleMatches && amountMatches && withinWindow;
        }).slice(0, 2);
    }, [effectiveTitle, numericAmount, recentTransactions, totalPaise]);

    useEffect(() => {
        setDuplicateAcknowledged(false);
    }, [effectiveTitle, payerId, selectedGroupId, splitType, totalPaise, selectedMemberIds]);

    /** Handle voice parsing result — auto-fill the form */
    const handleVoiceResult = useCallback((result: VoiceParseResult) => {
        // Set amount
        if (result.amount > 0) {
            const amtStr = result.amount % 1 === 0
                ? result.amount.toString()
                : result.amount.toFixed(2);
            setAmount(amtStr);
            setExpression('');
        }

        // Set title
        if (result.title && result.title !== 'Expense') {
            setTitle(result.title);
        }

        // Set category from voice
        if (result.category) {
            setCategory(result.category);
        }

        // Show warnings (e.g. unrecognized members)
        if (result.warnings && result.warnings.length > 0) {
            for (const w of result.warnings) {
                toast(w, 'error');
            }
        }

        // Match member names to IDs
        if (result.members && result.members.length > 0) {
            const matchedIds = new Set<string>();
            const matchedSplits: { userId: string; amount: number }[] = [];

            for (const vm of result.members) {
                const nameLower = vm.name.toLowerCase();
                const matched = members.find(m => {
                    const mLower = m.name.toLowerCase();
                    return mLower === nameLower
                        || mLower.startsWith(nameLower)
                        || nameLower.startsWith(mLower.split(' ')[0])
                        || mLower.split(' ')[0] === nameLower;
                });

                if (matched) {
                    matchedIds.add(matched.id);
                    if (vm.amount && vm.amount > 0) {
                        matchedSplits.push({
                            userId: matched.id,
                            amount: toPaise(vm.amount),
                        });
                    }
                }
            }

            // Only update if we found matches
            if (matchedIds.size > 0) {
                // Set voice flag BEFORE changing splitType/customSplits to prevent useEffect reset
                voiceAppliedRef.current = true;

                setSelectedMembers(matchedIds);

                // Set payer: try to match result.payer, otherwise use first mentioned member
                let assignedPayerId = Array.from(matchedIds)[0];
                if (result.payer) {
                    const payerLower = result.payer.toLowerCase();
                    const payerMatch = members.find(m => {
                        const mLower = m.name.toLowerCase();
                        return mLower === payerLower || mLower.startsWith(payerLower) || payerLower.startsWith(mLower.split(' ')[0]);
                    });
                    if (payerMatch) {
                        assignedPayerId = payerMatch.id;
                        // Special case: if payer wasn't in the split list, we might want to still add them as payer
                        // But since they paid, they are involved in the transaction.
                    }
                }
                
                if (assignedPayerId) {
                    setPayerId(assignedPayerId);
                }

                // Set split type
                if (result.splitType === 'custom' && matchedSplits.length > 0) {
                    setSplitType('custom');
                    // Auto-calculate remainder for last member if needed
                    const totalPaise = toPaise(result.amount);
                    const allocatedPaise = matchedSplits.reduce((s, sp) => s + sp.amount, 0);
                    const memberArr = Array.from(matchedIds);
                    const unassigned = memberArr.filter(
                        id => !matchedSplits.find(s => s.userId === id)
                    );

                    if (unassigned.length > 0 && allocatedPaise < totalPaise) {
                        const remainder = totalPaise - allocatedPaise;
                        const per = Math.floor(remainder / unassigned.length);
                        const leftover = remainder - per * unassigned.length;
                        unassigned.forEach((id, i) => {
                            matchedSplits.push({
                                userId: id,
                                amount: per + (i === unassigned.length - 1 ? leftover : 0),
                            });
                        });
                    }

                    setCustomSplits(matchedSplits);
                } else {
                    setSplitType('equal');
                    setCustomSplits([]);
                }
            }
        }

        toast('Voice input applied! Review and submit.', 'success');
    }, [members, toast]);

    const handleSave = async () => {
        if (!numericAmount || numericAmount <= 0) {
            toast('Amount must be greater than zero', 'error');
            return;
        }
        if (!selectedGroupId) {
            toast('Please select a group', 'error');
            return;
        }
        if (duplicateCandidates.length > 0 && !duplicateAcknowledged) {
            setDuplicateAcknowledged(true);
            toast('Possible duplicate found. Review the warning and tap Add Expense again if this is intentional.', 'error');
            return;
        }
        // Validate custom splits sum to total
        if (splitType === 'custom') {
            const selArr = Array.from(selectedMembers);
            const allocated = customSplits
                .filter(s => selArr.includes(s.userId))
                .reduce((sum, s) => sum + s.amount, 0);
            if (allocated !== totalPaise) {
                toast(`Split amounts (${formatCurrency(allocated)}) don't match total (${formatCurrency(totalPaise)})`, 'error');
                return;
            }
        }

        // If no trip exists yet, auto-create one
        let tripId = activeTripId;
        if (!tripId) {
            try {
                const tripRes = await fetch('/api/trips', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupId: selectedGroupId, title: 'General' }),
                });
                if (tripRes.ok) {
                    const trip = await tripRes.json();
                    tripId = trip.id;
                    setActiveTripId(trip.id);
                } else {
                    toast('Failed to create trip for this group', 'error');
                    return;
                }
            } catch {
                toast('Network error — please try again', 'error');
                return;
            }
        }

        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                tripId,
                title: effectiveTitle,
                amount: toPaise(numericAmount),
                category,
                method,
                splitType,
                payerId, // send who actually paid
            };

            const paramReceiptUrl = searchParams.get('receiptUrl');
            if (paramReceiptUrl) {
                payload.receiptUrl = paramReceiptUrl;
            }

            if (splitType === 'custom') {
                payload.splits = customSplits;
            } else {
                payload.splitAmong = Array.from(selectedMembers);
            }

            const res = await fetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                try {
                    window.localStorage.removeItem(EXPENSE_DRAFT_KEY);
                } catch {
                    // Ignore storage errors
                }
                toast(`Expense added! ${formatCurrency(toPaise(numericAmount))} for "${effectiveTitle}"`, 'success');
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
    const methodData = PAYMENT_METHODS[method];
    const recentGroups = recentGroupIds
        .map((groupId) => groups.find((group) => group.id === groupId))
        .filter((group): group is GroupItem => Boolean(group))
        .filter((group) => group.id !== selectedGroupId);
    const recentPayers = (recentPayersByGroup[selectedGroupId] || [])
        .map((memberId) => members.find((member) => member.id === memberId))
        .filter((member): member is { id: string; name: string; image?: string | null } => Boolean(member))
        .filter((member) => member.id !== payerId);

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

            {(recentGroups.length > 0 || selectedGroupId) && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    {recentGroups.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                            {recentGroups.map((group) => (
                                <button
                                    key={group.id}
                                    onClick={() => setSelectedGroupId(group.id)}
                                    style={{
                                        border: '1px solid var(--border-default)',
                                        background: 'var(--bg-glass)',
                                        color: 'var(--fg-secondary)',
                                        borderRadius: 'var(--radius-full)',
                                        padding: '6px 10px',
                                        fontSize: 'var(--text-xs)',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                    }}
                                >
                                    <History size={12} />
                                    <span>{group.emoji}</span>
                                    {group.name}
                                </button>
                            ))}
                        </div>
                    )}
                    <div style={{ fontSize: '10px', color: 'var(--fg-tertiary)', fontWeight: 600 }}>
                        Draft saves automatically on this device
                    </div>
                </div>
            )}

            {/* ── Amount Card (Glassmorphic) ── */}
            <div className={styles.amountCard}>
                <div className={styles.amountCardGlow} />

                <div className={styles.amountDisplay}>
                    <span className={styles.currencySign}>₹</span>
                    <input
                        ref={amountInputRef}
                        className={styles.amountInput}
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={expression || amount}
                        onChange={handleAmountInputChange}
                        onBlur={() => {
                            // Auto-evaluate expression on blur
                            if (hasOperator && expression) {
                                const result = evaluateExpression(expression);
                                const resultStr = result % 1 === 0 ? result.toString() : result.toFixed(2);
                                setAmount(resultStr);
                                setExpression('');
                            }
                        }}
                        aria-label="Amount"
                    />
                    <motion.button
                        className={styles.voiceBtn}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => {
                            // Voice input — handled by VoiceInput component below
                            const event = new CustomEvent('openVoiceInput');
                            window.dispatchEvent(event);
                        }}
                        aria-label="Voice input"
                    >
                        <Mic size={20} />
                    </motion.button>
                </div>

                {/* Expression preview */}
                <AnimatePresence>
                    {hasOperator && expression && (
                        <motion.div
                            className={styles.expressionPreview}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                        >
                            = ₹{evaluateExpression(expression).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── Category name pill (compact centered) ── */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '6px 14px 6px 10px',
                    borderRadius: 100,
                    border: '1.5px solid var(--border-subtle)',
                    background: 'var(--surface-card, rgba(255,255,255,0.03))',
                    transition: 'border-color 0.2s',
                }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{catData.emoji}</span>
                    <input
                        placeholder="Lunch, Uber..."
                        value={title}
                        onChange={(e) => {
                            setTitle(e.target.value);
                            const lower = e.target.value.toLowerCase().trim();
                            const matched = Object.entries(CATEGORIES).find(([, v]) =>
                                v.label.toLowerCase() === lower ||
                                v.label.toLowerCase().startsWith(lower)
                            );
                            if (matched && lower.length >= 3) {
                                setCategory(matched[0]);
                            } else if (lower && !CATEGORIES[lower]) {
                                setCategory(e.target.value.trim());
                            }
                        }}
                        maxLength={40}
                        style={{
                            border: 'none', outline: 'none', background: 'transparent',
                            fontSize: 13, fontWeight: 500, color: 'var(--fg-primary)',
                            textAlign: 'center', width: 110, minWidth: 70,
                            caretColor: 'var(--accent-500)',
                        }}
                    />
                </div>
            </div>

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

            {recentPayers.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {recentPayers.map((member) => (
                        <button
                            key={member.id}
                            onClick={() => setPayerId(member.id)}
                            style={{
                                border: '1px solid var(--border-default)',
                                background: 'var(--bg-glass)',
                                color: 'var(--fg-secondary)',
                                borderRadius: 'var(--radius-full)',
                                padding: '6px 10px',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                            }}
                        >
                            <History size={12} />
                            {member.id === currentUser?.id ? 'You' : member.name.split(' ')[0]}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Split Among Toggle ── */}
            {members.length > 1 && (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 0,
                    marginBottom: 0,
                }}>
                    <span style={{
                        fontSize: 10,
                        color: 'var(--fg-tertiary)',
                        fontWeight: 700,
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.1em',
                        textAlign: 'center' as const,
                        opacity: 0.7
                    }}>
                        {splitType === 'custom' ? 'Split by Items (Custom)' : 'Split among'}
                    </span>
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap' as const,
                        justifyContent: 'center',
                        gap: 8,
                    }}>
                        {members.map((member) => {
                            const isSelected = selectedMembers.has(member.id);
                            const isPayer = member.id === payerId;
                            const customAmount = getMemberAmount(member.id);

                            return (
                                <motion.button
                                    key={member.id}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => toggleMember(member.id)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8, // Increased internal gap
                                        padding: '6px 12px 6px 6px', // More breathing room inside pill
                                        borderRadius: 'var(--radius-full)',
                                        border: isSelected
                                            ? '1.5px solid var(--accent-500)'
                                            : '1.5px solid var(--border-default)',
                                        background: isSelected
                                            ? 'rgba(var(--accent-500-rgb), 0.08)' // Slightly more visible background
                                            : 'var(--bg-surface)', // Explicit surface color
                                        cursor: 'pointer',
                                        opacity: isSelected ? 1 : 0.6,
                                        transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
                                        boxShadow: isSelected ? '0 2px 8px rgba(var(--accent-500-rgb), 0.15)' : 'none', // Subtle lift for selected
                                    }}
                                >
                                    <Avatar name={member.name} image={member.image} size="sm" /> {/* Bumped up to size="sm" for better visibility */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
                                        <span style={{
                                            fontSize: 'var(--text-sm)', // Slightly larger text
                                            fontWeight: isSelected ? 600 : 500,
                                            textDecoration: isSelected ? 'none' : 'line-through',
                                            color: isSelected ? 'var(--fg-primary)' : 'var(--fg-tertiary)',
                                        }}>
                                            {member.id === currentUser?.id ? 'You' : member.name.split(' ')[0]}
                                        </span>
                                        {/* Show quantity or small numeric value if custom split */}
                                        {splitType === 'custom' && isSelected && (
                                            <span style={{
                                                fontSize: 10,
                                                fontWeight: 600,
                                                color: 'var(--accent-600)',
                                                marginTop: 2
                                            }}>
                                                {customAmount}
                                            </span>
                                        )}
                                    </div>

                                    {isPayer && (
                                        <span style={{
                                            fontSize: 9,
                                            background: isSelected ? 'var(--accent-500)' : 'var(--color-error, #ef4444)',
                                            color: '#fff',
                                            padding: '2px 6px',
                                            borderRadius: 'var(--radius-full)',
                                            fontWeight: 700,
                                            letterSpacing: '0.02em',
                                            marginLeft: 2,
                                        }}>{isSelected ? 'PAID' : 'PAID ONLY'}</span>
                                    )}
                                </motion.button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Split Mode Toggle + Split Info ── */}
            {numericAmount > 0 && selectedCount > 0 && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{ marginTop: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}
                >
                    {/* Equal / Custom toggle */}
                    <div style={{
                        display: 'flex',
                        borderRadius: 'var(--radius-full)',
                        border: '1px solid var(--border-default)',
                        overflow: 'hidden',
                    }}>
                        {(['equal', 'custom'] as const).map(mode => (
                            <button key={mode} onClick={() => {
                                if (mode === 'equal') { setSplitType('equal'); setCustomSplits([]); }
                                else {
                                    setSplitType('custom');
                                    // Initialize custom splits with equal amounts for selected members
                                    const selArr = Array.from(selectedMembers);
                                    const totalPaise = toPaise(numericAmount);
                                    const perPerson = Math.floor(totalPaise / selArr.length);
                                    const remainder = totalPaise - perPerson * selArr.length;
                                    setCustomSplits(selArr.map((id, i) => ({
                                        userId: id,
                                        amount: perPerson + (i === selArr.length - 1 ? remainder : 0),
                                    })));
                                }
                            }}
                                style={{
                                    padding: '6px 16px', fontSize: 'var(--text-xs)', fontWeight: 600,
                                    border: 'none', cursor: 'pointer',
                                    background: splitType === mode ? 'var(--accent-500)' : 'transparent',
                                    color: splitType === mode ? '#fff' : 'var(--fg-secondary)',
                                    transition: 'all 0.2s',
                                }}
                            >
                                {mode === 'equal' ? '÷ Equal' : '✏️ Custom'}
                            </button>
                        ))}
                    </div>

                    {splitType === 'equal' ? (
                        <div className={styles.splitInfo}>
                            Split equally: <span className={styles.splitAmount}>{splitPerPerson}</span> / person
                            ({selectedCount} of {members.length} people)
                        </div>
                    ) : (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, padding: '0 4px' }}>
                            {/* Per-person amount inputs */}
                            {(() => {
                                const selArr = Array.from(selectedMembers);
                                const totalPaise = toPaise(numericAmount);

                                return selArr.map((memberId, idx) => {
                                    const member = members.find(m => m.id === memberId);
                                    if (!member) return null;
                                    const isLast = idx === selArr.length - 1;
                                    const split = customSplits.find(s => s.userId === memberId);
                                    const currentAmount = split?.amount || 0;

                                    // For last person: auto-calculate remaining
                                    const othersTotal = customSplits
                                        .filter(s => s.userId !== memberId && selArr.includes(s.userId))
                                        .reduce((sum, s) => sum + s.amount, 0);
                                    const autoFillAmount = isLast ? Math.max(0, totalPaise - othersTotal) : currentAmount;

                                    // If last person, auto-update their split
                                    if (isLast && split && split.amount !== autoFillAmount) {
                                        setTimeout(() => {
                                            setCustomSplits(prev => prev.map(s =>
                                                s.userId === memberId ? { ...s, amount: autoFillAmount } : s
                                            ));
                                        }, 0);
                                    }

                                    return (
                                        <div key={memberId} style={{
                                            display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '12px 16px',
                                            background: isLast
                                                ? 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.06), rgba(var(--accent-500-rgb), 0.02))'
                                                : 'var(--bg-surface)',
                                            borderRadius: 16,
                                            border: isLast
                                                ? '1.5px solid rgba(var(--accent-500-rgb), 0.2)'
                                                : '1px solid var(--border-subtle)',
                                            transition: 'all 0.2s ease',
                                        }}>
                                            <Avatar name={member.name} image={member.image} size="sm" />
                                            <span style={{
                                                flex: 1, fontSize: 'var(--text-sm)', fontWeight: 600,
                                                color: 'var(--fg-primary)',
                                            }}>
                                                {member.id === currentUser?.id ? 'You' : member.name.split(' ')[0]}
                                                {isLast && (
                                                    <span style={{
                                                        fontSize: 10, color: 'var(--accent-500)',
                                                        fontWeight: 500, marginLeft: 6,
                                                        opacity: 0.8,
                                                    }}>(remainder)</span>
                                                )}
                                            </span>
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 2,
                                                background: isLast ? 'rgba(var(--accent-500-rgb), 0.1)' : 'var(--bg-elevated)',
                                                borderRadius: 12,
                                                padding: '6px 4px 6px 10px',
                                                border: `1px solid ${isLast ? 'var(--accent-500)' : 'var(--border-default)'}`,
                                            }}>
                                                <span style={{
                                                    fontSize: 'var(--text-sm)',
                                                    color: isLast ? 'var(--accent-500)' : 'var(--fg-tertiary)',
                                                    fontWeight: 600,
                                                }}>₹</span>
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    value={isLast ? (autoFillAmount / 100).toFixed(2) : (currentAmount / 100) || ''}
                                                    readOnly={isLast}
                                                    onChange={e => {
                                                        if (isLast) return;
                                                        const val = Math.round(parseFloat(e.target.value || '0') * 100);
                                                        setCustomSplits(prev => {
                                                            const existing = prev.find(s => s.userId === memberId);
                                                            if (existing) return prev.map(s => s.userId === memberId ? { ...s, amount: val } : s);
                                                            return [...prev, { userId: memberId, amount: val }];
                                                        });
                                                    }}
                                                    style={{
                                                        width: 72, padding: '4px 6px',
                                                        fontSize: 'var(--text-base)', fontWeight: 700,
                                                        background: 'transparent',
                                                        border: 'none',
                                                        color: isLast ? 'var(--accent-500)' : 'var(--fg-primary)',
                                                        outline: 'none',
                                                        textAlign: 'right',
                                                    }}
                                                    placeholder="0"
                                                />
                                            </div>
                                        </div>
                                    );
                                });
                            })()}

                            {/* Running total bar */}
                            {(() => {
                                const totalPaise = toPaise(numericAmount);
                                const allocated = customSplits
                                    .filter(s => Array.from(selectedMembers).includes(s.userId))
                                    .reduce((sum, s) => sum + s.amount, 0);
                                const pct = totalPaise > 0 ? Math.min((allocated / totalPaise) * 100, 100) : 0;
                                const isExact = allocated === totalPaise;
                                const isOver = allocated > totalPaise;

                                return (
                                    <div style={{ width: '100%', marginTop: 4 }}>
                                        <div style={{
                                            height: 6, borderRadius: 3,
                                            background: 'var(--border-subtle)',
                                            overflow: 'hidden',
                                        }}>
                                            <div style={{
                                                height: '100%',
                                                width: `${pct}%`,
                                                borderRadius: 3,
                                                background: isExact
                                                    ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                                                    : isOver
                                                        ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                                                        : 'linear-gradient(90deg, var(--accent-400), var(--accent-600))',
                                                transition: 'width 0.3s, background 0.3s',
                                            }} />
                                        </div>
                                        <div style={{
                                            fontSize: 'var(--text-xs)', textAlign: 'center',
                                            marginTop: 6,
                                            color: isExact ? '#22c55e' : isOver ? '#ef4444' : 'var(--fg-tertiary)',
                                            fontWeight: 700,
                                            letterSpacing: '0.02em',
                                        }}>
                                            {formatCurrency(allocated)} of {formatCurrency(totalPaise)} allocated
                                            {isExact && ' ✓'}
                                            {isOver && ' ⚠ over!'}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                </motion.div>
            )}

            {/* ── Numpad (4-column with calculator) ── */}
            {impactPreview.length > 0 && (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: '14px',
                    borderRadius: 'var(--radius-xl)',
                    background: 'rgba(var(--accent-500-rgb), 0.05)',
                    border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TrendingUp size={14} style={{ color: 'var(--accent-500)' }} />
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                            Impact Preview
                        </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {impactPreview.map((entry) => (
                            <div
                                key={entry.memberId}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 12,
                                    padding: '10px 12px',
                                    borderRadius: 'var(--radius-lg)',
                                    background: 'var(--bg-glass)',
                                    border: '1px solid var(--border-glass)',
                                }}
                            >
                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-primary)' }}>
                                    {entry.name}
                                </div>
                                <div style={{
                                    fontSize: 'var(--text-xs)',
                                    fontWeight: 700,
                                    color: entry.delta >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                                }}>
                                    {entry.delta >= 0 ? 'Will be owed more ' : 'Will owe more '}
                                    {entry.delta >= 0 ? '+' : '-'}{formatCurrency(Math.abs(entry.delta))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {duplicateCandidates.length > 0 && (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: '14px',
                    borderRadius: 'var(--radius-xl)',
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.18)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b' }}>
                        <AlertTriangle size={16} />
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>Possible duplicate expense</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {duplicateCandidates.map((transaction) => (
                            <div
                                key={transaction.id}
                                style={{
                                    padding: '10px 12px',
                                    borderRadius: 'var(--radius-lg)',
                                    background: 'rgba(255,255,255,0.4)',
                                    border: '1px solid rgba(245, 158, 11, 0.12)',
                                }}
                            >
                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)' }}>
                                    {transaction.title} • {formatCurrency(transaction.amount)}
                                </div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', marginTop: 4 }}>
                                    Paid by {transaction.payer.name || 'Unknown'} • {new Date(transaction.createdAt).toLocaleString('en-IN', {
                                        day: 'numeric',
                                        month: 'short',
                                        hour: 'numeric',
                                        minute: '2-digit',
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
                        Tap Add Expense once more only if this is a real second charge.
                    </div>
                </div>
            )}

            <div className={styles.numpad}>
                {['1', '2', '3', '+', '4', '5', '6', '-', '7', '8', '9', 'del', '.', '0', '00', '='].map((key) => (
                    <motion.button
                        key={key}
                        className={cn(
                            styles.numKey,
                            (key === '+' || key === '-') && styles.numKeyOperator,
                            key === 'del' && styles.numKeyDelete,
                            key === '=' && styles.numKeyEquals,
                        )}
                        whileTap={{ scale: 0.92 }}
                        onClick={() => {
                            if (key === '00') {
                                handleNumPad('0');
                                handleNumPad('0');
                            } else {
                                handleNumPad(key);
                            }
                        }}
                        aria-label={key === 'del' ? 'Delete' : key === '=' ? 'Calculate' : key}
                    >
                        {key === 'del' ? <Delete size={20} /> :
                         key === '+' ? <Plus size={20} /> :
                         key === '-' ? <Minus size={20} /> :
                         key === '=' ? <Equal size={20} /> :
                         key}
                    </motion.button>
                ))}
            </div>

            {/* ── Submit ── */}
            <div className={styles.submitBtn}>
                <Button
                    fullWidth
                    size="lg"
                    disabled={!numericAmount}
                    loading={saving}
                    leftIcon={<Check size={18} />}
                    onClick={handleSave}
                >
                    Add Expense · {numericAmount > 0 ? formatCurrency(toPaise(numericAmount)) : '₹0'}
                </Button>
            </div>

            {/* ── Voice Input Overlay ── */}
            <VoiceInput
                memberNames={members.map(m => m.name)}
                members={members.map(m => ({ name: m.name, image: m.image }))}
                groupName={selectedGroup?.name || 'Group'}
                onResult={handleVoiceResult}
            />

            {/* ── Group Picker Modal ── */}
            <Modal
                isOpen={showGroups}
                onClose={() => setShowGroups(false)}
                title="Select Group"
                size="small"
                transparentOverlay
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
                onClose={() => { setShowCategories(false); setIsCustomCategory(false); }}
                title={isCustomCategory ? "Custom Category" : "Category"}
                size="small"
                transparentOverlay
            >
                {isCustomCategory ? (
                    <div style={{ padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 14, top: 12, fontSize: 18 }}>📌</span>
                            <input
                                autoFocus
                                placeholder="e.g. Flight to Goa"
                                value={customCatValue}
                                onChange={(e) => setCustomCatValue(e.target.value)}
                                style={{
                                    width: '100%', padding: '14px 16px 14px 44px', borderRadius: '14px',
                                    border: '1px solid var(--border-subtle)', background: 'var(--bg-glass)',
                                    color: 'var(--fg-primary)', fontSize: '15px', fontWeight: 500,
                                    outline: 'none', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)'
                                }}
                            />
                        </div>
                        <Button
                            fullWidth
                            disabled={!customCatValue.trim()}
                            onClick={() => {
                                setCategory(customCatValue.trim());
                                setShowCategories(false);
                                setIsCustomCategory(false);
                            }}
                        >
                            Save Category
                        </Button>
                        <button
                            onClick={() => { setIsCustomCategory(false); setCustomCatValue(''); }}
                            style={{ marginTop: 2, background: 'none', border: 'none', color: 'var(--fg-tertiary)', fontSize: 13, cursor: 'pointer', padding: 8, fontWeight: 500 }}
                        >
                            Back to preset categories
                        </button>
                    </div>
                ) : (
                    <div className={styles.categoryGrid}>
                        {Object.entries(CATEGORIES).map(([key, val]) => (
                            <motion.button
                                key={key}
                                className={cn(
                                    styles.categoryItem,
                                    category === key && styles.categoryItemActive,
                                    (!CATEGORIES[category] && key === 'other') && styles.categoryItemActive
                                )}
                                whileTap={{ scale: 0.93 }}
                                onClick={() => {
                                    setCategory(key);
                                    setShowCategories(false);
                                }}
                            >
                                <span className={styles.categoryEmoji}>{val.emoji}</span>
                                <span className={styles.categoryLabel}>{val.label}</span>
                            </motion.button>
                        ))}
                    </div>
                )}
            </Modal>

            {/* ── Payer Picker Modal ── */}
            <Modal
                isOpen={showPayers}
                onClose={() => setShowPayers(false)}
                title="Who paid?"
                size="small"
                transparentOverlay
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
                            <Avatar name={member.name} image={member.image} size="sm" />
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
                transparentOverlay
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
                            <PaymentIcon method={key} size={22} />
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

export default function QuickAddPage() {
    return (
        <Suspense fallback={
            <div style={{ display: 'flex', height: '100dvh', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 className="animate-spin" size={32} style={{ color: 'var(--fg-muted)' }} />
            </div>
        }>
            <QuickAddContent />
        </Suspense>
    );
}
