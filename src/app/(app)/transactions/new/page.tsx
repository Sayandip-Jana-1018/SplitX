'use client';

import { useState, useCallback, useEffect, useRef, Suspense, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AlertTriangle,
    Check,
    ChevronDown,
    ClipboardCheck,
    Delete,
    Equal,
    History,
    Mic,
    Minus,
    PencilLine,
    Plus,
    ScanLine,
    TrendingUp,
    Users,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { CategoryTile, PaymentIcon, getCategoryConfig } from '@/components/ui/Icons';
import { Notice, Progress, Segmented } from '@/components/ui/kit';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useHaptics } from '@/hooks/useHaptics';
import { inferCategory } from '@/lib/categoryInference';
import { refreshMoneyData } from '@/lib/swr';
import { CATEGORIES, PAYMENT_METHODS, formatCurrency, toPaise, cn } from '@/lib/utils';
import { equalSharesById } from '@/lib/splits';

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

interface MemberItem {
    id: string;
    name: string;
    image?: string | null;
}

type SplitMode = 'equal' | 'custom';

const EXPENSE_DRAFT_KEY = 'splitx:add-expense-draft:v1';
const RECENT_GROUPS_KEY = 'splitx:recent-groups:v1';
const RECENT_PAYERS_KEY = 'splitx:recent-payers:v1';

const NUMPAD_KEYS = ['1', '2', '3', '+', '4', '5', '6', '-', '7', '8', '9', 'del', '.', '0', '00', '='];

const SOURCE_COPY: Record<string, string> = {
    clipboard: 'Filled in from a payment you copied — check the details before saving.',
    scan: 'Filled in from your receipt scan — check the details before saving.',
    notification: 'Filled in from a payment notification — check the details before saving.',
};

function QuickAddContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const haptics = useHaptics();
    const { user: currentUser, loading: userLoading } = useCurrentUser();

    // ── Data ──
    const [groups, setGroups] = useState<GroupItem[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<string>('');
    const [activeTripId, setActiveTripId] = useState<string>('');
    const [members, setMembers] = useState<MemberItem[]>([]);
    const [loadingGroups, setLoadingGroups] = useState(true);
    const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);
    const [recentGroupIds, setRecentGroupIds] = useState<string[]>([]);
    const [recentPayersByGroup, setRecentPayersByGroup] = useState<Record<string, string[]>>({});
    const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

    // ── Form ──
    const [amount, setAmount] = useState('');
    const [title, setTitle] = useState('');
    const [category, setCategory] = useState('general');
    const [categoryTouched, setCategoryTouched] = useState(false);
    const [method, setMethod] = useState('cash');
    const [payerId, setPayerId] = useState('');
    const [sheet, setSheet] = useState<'group' | 'category' | 'payer' | 'method' | null>(null);
    const [saving, setSaving] = useState(false);
    const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
    const [isCustomCategory, setIsCustomCategory] = useState(false);
    const [customCatValue, setCustomCatValue] = useState('');
    const [splitType, setSplitType] = useState<SplitMode>('equal');
    const [customSplits, setCustomSplits] = useState<{ userId: string; amount: number }[]>([]);
    const [expression, setExpression] = useState('');

    const voiceAppliedRef = useRef(false);
    const restoredDraftRef = useRef(false);
    const lastLoadedGroupRef = useRef<string | null>(null);
    const latestRef = useRef({ splitType, customSplits, payerId, selectedMembers });

    useEffect(() => {
        latestRef.current = { splitType, customSplits, payerId, selectedMembers };
    });

    const source = searchParams.get('source') || (searchParams.get('receiptUrl') ? 'scan' : null);

    /** Evaluate a simple left-to-right expression with + and - */
    const evaluateExpression = useCallback((expr: string): number => {
        const sanitized = expr.replace(/[^\d.+-]/g, '').replace(/^[+-]/, '');
        if (!sanitized) return 0;
        const tokens = sanitized.split(/(?=[+-])|(?<=[+-])/).filter((token) => token.trim());
        let total = 0;
        let op = '+';
        for (const token of tokens) {
            const trimmed = token.trim();
            if (trimmed === '+' || trimmed === '-') { op = trimmed; continue; }
            const num = parseFloat(trimmed);
            if (isNaN(num)) continue;
            total = op === '+' ? total + num : total - num;
        }
        return Math.max(0, Math.round(total * 100) / 100);
    }, []);

    const hasOperator = expression.includes('+') || expression.includes('-');

    // ── Prefill from URL (receipt scan, clipboard, notification deep-links) ──
    useEffect(() => {
        const paramAmount = searchParams.get('amount');
        const paramTitle = searchParams.get('title');
        const paramMethod = searchParams.get('method');
        const paramCategory = searchParams.get('category');
        const paramSplitData = searchParams.get('splitData');
        if (paramAmount) setAmount(paramAmount);
        if (paramTitle) setTitle(paramTitle);
        if (paramMethod && PAYMENT_METHODS[paramMethod]) setMethod(paramMethod);
        if (paramCategory) {
            setCategory(paramCategory);
            setCategoryTouched(true);
        } else if (paramTitle) {
            const inferred = inferCategory(paramTitle);
            if (inferred) setCategory(inferred);
        }

        if (paramSplitData) {
            try {
                const splits = JSON.parse(paramSplitData);
                if (Array.isArray(splits) && splits.length > 0) {
                    setCustomSplits(splits);
                    setSplitType('custom');
                    setSelectedMembers(new Set(splits.map((split: { userId: string }) => split.userId)));
                }
            } catch (error) {
                console.error('Failed to parse split data', error);
            }
        }
    }, [searchParams]);

    // ── Groups ──
    useEffect(() => {
        async function loadGroups() {
            try {
                const res = await fetch('/api/groups');
                if (res.ok) {
                    const data: GroupItem[] = await res.json();
                    setGroups(data);
                    const requested = searchParams.get('groupId');
                    const initial = data.find((group) => group.id === requested) ?? data[0];
                    if (initial) setSelectedGroupId(initial.id);
                }
            } catch {
                // handled by empty state
            } finally {
                setLoadingGroups(false);
            }
        }
        loadGroups();
    }, [searchParams]);

    useEffect(() => {
        try {
            const storedGroups = window.localStorage.getItem(RECENT_GROUPS_KEY);
            const storedPayers = window.localStorage.getItem(RECENT_PAYERS_KEY);
            if (storedGroups) setRecentGroupIds(JSON.parse(storedGroups));
            if (storedPayers) setRecentPayersByGroup(JSON.parse(storedPayers));
        } catch {
            // Ignore malformed local data
        }
    }, []);

    // ── Draft restore (only when nothing was pre-filled) ──
    useEffect(() => {
        if (loadingGroups || restoredDraftRef.current || groups.length === 0) return;

        const hasUrlPrefill = ['amount', 'title', 'method', 'category', 'splitData', 'receiptUrl', 'groupId']
            .some((key) => searchParams.has(key));

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
                splitType?: SplitMode;
                selectedMemberIds?: string[];
                customSplits?: { userId: string; amount: number }[];
            };

            if (draft.selectedGroupId && groups.some((group) => group.id === draft.selectedGroupId)) {
                setSelectedGroupId(draft.selectedGroupId);
            }
            if (draft.amount) setAmount(draft.amount);
            if (draft.title) setTitle(draft.title);
            if (draft.category) {
                setCategory(draft.category);
                setCategoryTouched(true);
            }
            if (draft.method) setMethod(draft.method);
            if (draft.payerId) setPayerId(draft.payerId);
            if (draft.splitType) setSplitType(draft.splitType);
            if (draft.selectedMemberIds?.length) setSelectedMembers(new Set(draft.selectedMemberIds));
            if (draft.customSplits?.length) setCustomSplits(draft.customSplits);
        } catch {
            // Ignore malformed drafts
        }
    }, [groups, loadingGroups, searchParams]);

    // ── Draft autosave ──
    useEffect(() => {
        if (loadingGroups || !selectedGroupId) return;
        try {
            window.localStorage.setItem(EXPENSE_DRAFT_KEY, JSON.stringify({
                selectedGroupId,
                amount,
                title,
                category: categoryTouched ? category : undefined,
                method,
                payerId,
                splitType,
                selectedMemberIds: Array.from(selectedMembers),
                customSplits,
                savedAt: new Date().toISOString(),
            }));
        } catch {
            // Ignore storage errors
        }
    }, [amount, category, categoryTouched, customSplits, loadingGroups, method, payerId, selectedGroupId, selectedMembers, splitType, title]);

    // ── Group detail: members, active trip, sensible defaults ──
    useEffect(() => {
        if (!selectedGroupId) return;
        let cancelled = false;

        async function loadGroupDetail() {
            try {
                const res = await fetch(`/api/groups/${selectedGroupId}`);
                if (!res.ok || cancelled) return;
                const data = await res.json();

                if (data.activeTrip) {
                    setActiveTripId(data.activeTrip.id);
                } else {
                    try {
                        const tripRes = await fetch('/api/trips', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ groupId: selectedGroupId, title: 'General' }),
                        });
                        if (tripRes.ok && !cancelled) {
                            const trip = await tripRes.json();
                            setActiveTripId(trip.id);
                        }
                    } catch { /* surfaced on save */ }
                }

                if (cancelled) return;
                const memberList: MemberItem[] = (data.members || []).map((m: { user: { id: string; name: string | null; image?: string | null } }) => ({
                    id: m.user.id,
                    name: m.user.name || 'Unknown',
                    image: m.user.image || null,
                }));
                setMembers(memberList);

                const memberIds = new Set(memberList.map((member) => member.id));
                const switchedGroup = lastLoadedGroupRef.current !== null && lastLoadedGroupRef.current !== selectedGroupId;
                lastLoadedGroupRef.current = selectedGroupId;

                if (voiceAppliedRef.current) {
                    voiceAppliedRef.current = false;
                    return;
                }

                const latest = latestRef.current;
                const selectionValid = latest.selectedMembers.size > 0
                    && Array.from(latest.selectedMembers).every((id) => memberIds.has(id));

                if (latest.splitType === 'custom' && latest.customSplits.length > 0 && !switchedGroup) {
                    setSelectedMembers(new Set(latest.customSplits.map((split) => split.userId).filter((id) => memberIds.has(id))));
                } else if (switchedGroup || !selectionValid) {
                    setSelectedMembers(new Set(memberIds));
                    if (switchedGroup) {
                        setSplitType('equal');
                        setCustomSplits([]);
                    }
                }

                if (!latest.payerId || !memberIds.has(latest.payerId)) {
                    const fallback = currentUser && memberIds.has(currentUser.id) ? currentUser.id : memberList[0]?.id;
                    if (fallback) setPayerId(fallback);
                }
            } catch {
                // silent — the form stays usable
            }
        }

        loadGroupDetail();
        return () => { cancelled = true; };
    }, [selectedGroupId, currentUser]);

    // ── Recents ──
    useEffect(() => {
        if (!selectedGroupId) return;
        setRecentGroupIds((prev) => {
            const next = [selectedGroupId, ...prev.filter((groupId) => groupId !== selectedGroupId)].slice(0, 3);
            try { window.localStorage.setItem(RECENT_GROUPS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
        });
    }, [selectedGroupId]);

    useEffect(() => {
        if (!selectedGroupId || !payerId) return;
        setRecentPayersByGroup((prev) => {
            const existing = prev[selectedGroupId] || [];
            const next = { ...prev, [selectedGroupId]: [payerId, ...existing.filter((id) => id !== payerId)].slice(0, 3) };
            try { window.localStorage.setItem(RECENT_PAYERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
        });
    }, [payerId, selectedGroupId]);

    useEffect(() => {
        if (!activeTripId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/transactions?tripId=${activeTripId}&limit=20`);
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled) setRecentTransactions(Array.isArray(data) ? data : []);
            } catch {
                if (!cancelled) setRecentTransactions([]);
            }
        })();
        return () => { cancelled = true; };
    }, [activeTripId]);

    // ── Derived values ──
    const numericAmount = parseFloat(amount) || 0;
    const totalPaise = toPaise(numericAmount);
    const selectedMemberIds = useMemo(
        () => members.filter((member) => selectedMembers.has(member.id)).map((member) => member.id),
        [members, selectedMembers]
    );
    const selectedCount = selectedMemberIds.length;

    /** Custom plan: everyone except the last person is typed in; the last absorbs the remainder. */
    const customPlan = useMemo(() => {
        if (splitType !== 'custom' || selectedMemberIds.length === 0) return null;
        const lastId = selectedMemberIds[selectedMemberIds.length - 1];
        const others = selectedMemberIds.slice(0, -1).map((id) => ({
            userId: id,
            amount: customSplits.find((split) => split.userId === id)?.amount ?? 0,
        }));
        const othersTotal = others.reduce((sum, split) => sum + split.amount, 0);
        const lastAmount = totalPaise - othersTotal;
        return {
            splits: [...others, { userId: lastId, amount: lastAmount }],
            lastId,
            lastAmount,
            othersTotal,
            overAllocated: lastAmount < 0,
        };
    }, [customSplits, selectedMemberIds, splitType, totalPaise]);

    // The same function the server uses, so the preview shows exactly what gets saved.
    const equalShares = useMemo(
        () => (selectedCount === 0 ? new Map<string, number>() : equalSharesById(totalPaise, selectedMemberIds)),
        [selectedCount, selectedMemberIds, totalPaise]
    );

    const shareFor = useCallback((memberId: string) => {
        if (splitType === 'custom') return customPlan?.splits.find((split) => split.userId === memberId)?.amount ?? 0;
        return equalShares.get(memberId) ?? 0;
    }, [customPlan, equalShares, splitType]);

    const categoryConfig = getCategoryConfig(category);
    const categoryLabel = CATEGORIES[category]?.label || categoryConfig.label;
    const effectiveTitle = title.trim() || categoryLabel;

    const impactPreview = useMemo(() => {
        if (!numericAmount || selectedMemberIds.length === 0) return [];
        const involved = new Set([...selectedMemberIds, payerId]);
        return members
            .filter((member) => involved.has(member.id))
            .map((member) => {
                const share = selectedMembers.has(member.id) ? shareFor(member.id) : 0;
                const delta = (member.id === payerId ? totalPaise : 0) - share;
                return {
                    memberId: member.id,
                    name: member.id === currentUser?.id ? 'You' : member.name.split(' ')[0],
                    image: member.image,
                    fullName: member.name,
                    delta,
                };
            })
            .filter((entry) => entry.delta !== 0);
    }, [currentUser?.id, members, numericAmount, payerId, selectedMemberIds, selectedMembers, shareFor, totalPaise]);

    const duplicateCandidates = useMemo(() => {
        if (!effectiveTitle || !numericAmount) return [];
        const normalizedTitle = effectiveTitle.toLowerCase().trim();
        const windowStart = Date.parse(new Date().toISOString()) - 3 * 24 * 60 * 60 * 1000;
        return recentTransactions.filter((transaction) =>
            transaction.title.toLowerCase().trim() === normalizedTitle
            && transaction.amount === totalPaise
            && new Date(transaction.createdAt).getTime() >= windowStart
        ).slice(0, 2);
    }, [effectiveTitle, numericAmount, recentTransactions, totalPaise]);

    useEffect(() => {
        setDuplicateAcknowledged(false);
    }, [effectiveTitle, payerId, selectedGroupId, splitType, totalPaise, selectedMemberIds]);

    // ── Handlers ──
    const resetCustomEvenly = useCallback((ids: string[], total: number) => {
        if (ids.length === 0) {
            setCustomSplits([]);
            return;
        }
        const each = Math.floor(total / ids.length);
        const remainder = total - each * ids.length;
        setCustomSplits(ids.map((id, index) => ({ userId: id, amount: each + (index === ids.length - 1 ? remainder : 0) })));
    }, []);

    const toggleMember = useCallback((memberId: string) => {
        const next = new Set(selectedMembers);
        if (next.has(memberId)) {
            if (next.size <= 1) {
                toast('At least one person has to share the expense', 'info');
                return;
            }
            next.delete(memberId);
        } else {
            next.add(memberId);
        }
        haptics.light();
        setSelectedMembers(next);
        if (splitType === 'custom') {
            resetCustomEvenly(members.filter((member) => next.has(member.id)).map((member) => member.id), totalPaise);
        }
    }, [haptics, members, resetCustomEvenly, selectedMembers, splitType, toast, totalPaise]);

    const changeSplitMode = (mode: SplitMode) => {
        if (mode === splitType) return;
        haptics.light();
        setSplitType(mode);
        if (mode === 'equal') setCustomSplits([]);
        else resetCustomEvenly(selectedMemberIds, totalPaise);
    };

    const handleNumPad = useCallback((key: string) => {
        if (key === 'del') {
            if (expression) {
                const next = expression.slice(0, -1);
                if (next.includes('+') || next.includes('-')) setExpression(next);
                else {
                    setExpression('');
                    setAmount(next);
                }
            } else {
                setAmount((prev) => prev.slice(0, -1));
            }
        } else if (key === '+' || key === '-') {
            const base = expression || amount;
            if (!base) return;
            const last = base.charAt(base.length - 1);
            if (last === '+' || last === '-' || last === '.') return;
            setExpression(base + key);
        } else if (key === '=') {
            const expr = expression || amount;
            if (!expr) return;
            const result = evaluateExpression(expr);
            setAmount(result % 1 === 0 ? result.toString() : result.toFixed(2));
            setExpression('');
        } else if (key === '.') {
            const base = expression || amount;
            const lastOpIdx = Math.max(base.lastIndexOf('+'), base.lastIndexOf('-'));
            const lastSegment = lastOpIdx >= 0 ? base.substring(lastOpIdx + 1) : base;
            if (lastSegment.includes('.')) return;
            const next = (lastSegment ? base : `${base}0`) + '.';
            if (expression) setExpression(next);
            else setAmount(next);
        } else {
            const base = expression || amount;
            const lastOpIdx = Math.max(base.lastIndexOf('+'), base.lastIndexOf('-'));
            const lastSegment = lastOpIdx >= 0 ? base.substring(lastOpIdx + 1) : base;
            const [whole, fraction] = lastSegment.split('.');
            if (fraction !== undefined && fraction.length >= 2) return;
            if (fraction === undefined && whole && whole.length >= 7) return;
            const next = !base && key === '0' ? '0' : base === '0' ? key : base + key;
            if (expression) setExpression(next);
            else setAmount(next);
        }
        haptics.light();
    }, [amount, evaluateExpression, expression, haptics]);

    const handleAmountInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const cleaned = event.target.value.replace(/[^\d.+-]/g, '');
        if (cleaned.includes('+') || cleaned.includes('-')) {
            setExpression(cleaned);
        } else {
            setExpression('');
            setAmount(cleaned);
        }
    }, []);

    const handleTitleChange = (value: string) => {
        setTitle(value);
        if (!categoryTouched) {
            const inferred = inferCategory(value);
            setCategory(inferred ?? 'general');
        }
    };

    const handleVoiceResult = useCallback((result: VoiceParseResult) => {
        if (result.amount > 0) {
            setAmount(result.amount % 1 === 0 ? result.amount.toString() : result.amount.toFixed(2));
            setExpression('');
        }
        if (result.title && result.title !== 'Expense') setTitle(result.title);
        if (result.category) {
            setCategory(result.category);
            setCategoryTouched(true);
        }
        for (const warning of result.warnings ?? []) toast(warning, 'error');

        if (result.members && result.members.length > 0) {
            const matchedIds = new Set<string>();
            const matchedSplits: { userId: string; amount: number }[] = [];

            for (const voiceMember of result.members) {
                const nameLower = voiceMember.name.toLowerCase();
                const matched = members.find((member) => {
                    const memberLower = member.name.toLowerCase();
                    return memberLower === nameLower
                        || memberLower.startsWith(nameLower)
                        || nameLower.startsWith(memberLower.split(' ')[0])
                        || memberLower.split(' ')[0] === nameLower;
                });
                if (matched) {
                    matchedIds.add(matched.id);
                    if (voiceMember.amount && voiceMember.amount > 0) {
                        matchedSplits.push({ userId: matched.id, amount: toPaise(voiceMember.amount) });
                    }
                }
            }

            if (matchedIds.size > 0) {
                voiceAppliedRef.current = true;
                setSelectedMembers(matchedIds);

                let assignedPayerId = Array.from(matchedIds)[0];
                if (result.payer) {
                    const payerLower = result.payer.toLowerCase();
                    const payerMatch = members.find((member) => {
                        const memberLower = member.name.toLowerCase();
                        return memberLower === payerLower || memberLower.startsWith(payerLower) || payerLower.startsWith(memberLower.split(' ')[0]);
                    });
                    if (payerMatch) assignedPayerId = payerMatch.id;
                }
                if (assignedPayerId) setPayerId(assignedPayerId);

                if (result.splitType === 'custom' && matchedSplits.length > 0) {
                    const voiceTotal = toPaise(result.amount);
                    const allocated = matchedSplits.reduce((sum, split) => sum + split.amount, 0);
                    const unassigned = Array.from(matchedIds).filter((id) => !matchedSplits.some((split) => split.userId === id));
                    if (unassigned.length > 0 && allocated < voiceTotal) {
                        const remainder = voiceTotal - allocated;
                        const each = Math.floor(remainder / unassigned.length);
                        const leftover = remainder - each * unassigned.length;
                        unassigned.forEach((id, index) => {
                            matchedSplits.push({ userId: id, amount: each + (index === unassigned.length - 1 ? leftover : 0) });
                        });
                    }
                    setSplitType('custom');
                    setCustomSplits(matchedSplits);
                } else {
                    setSplitType('equal');
                    setCustomSplits([]);
                }
            }
        }

        toast('Voice input applied — review and save', 'success');
    }, [members, toast]);

    const handleSave = async () => {
        if (!numericAmount || numericAmount <= 0) {
            toast('Enter an amount greater than zero', 'error');
            return;
        }
        if (!selectedGroupId) {
            toast('Pick a group first', 'error');
            return;
        }
        if (duplicateCandidates.length > 0 && !duplicateAcknowledged) {
            setDuplicateAcknowledged(true);
            haptics.heavy();
            toast('This looks like a duplicate. Tap Add again if it’s a real second charge.', 'warning');
            return;
        }
        if (splitType === 'custom') {
            if (!customPlan || customPlan.overAllocated) {
                toast(`Split amounts are over the total of ${formatCurrency(totalPaise)}`, 'error');
                return;
            }
        }

        let tripId = activeTripId;
        if (!tripId) {
            try {
                const tripRes = await fetch('/api/trips', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupId: selectedGroupId, title: 'General' }),
                });
                if (!tripRes.ok) {
                    toast('Could not prepare this group for expenses', 'error');
                    return;
                }
                const trip = await tripRes.json();
                tripId = trip.id;
                setActiveTripId(trip.id);
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
                amount: totalPaise,
                category,
                method,
                splitType,
                payerId,
            };
            const receiptUrl = searchParams.get('receiptUrl');
            if (receiptUrl) payload.receiptUrl = receiptUrl;
            if (splitType === 'custom' && customPlan) {
                payload.splits = customPlan.splits.filter((split) => split.amount > 0);
            } else {
                payload.splitAmong = selectedMemberIds;
            }

            const res = await fetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                const created = await res.json().catch(() => null);
                try { window.localStorage.removeItem(EXPENSE_DRAFT_KEY); } catch { /* ignore */ }
                haptics.success();
                void refreshMoneyData();
                toast(`Added ${formatCurrency(totalPaise)} · ${effectiveTitle}`, 'success', created?.id ? {
                    duration: 6000,
                    action: {
                        label: 'Undo',
                        onClick: async () => {
                            try {
                                const undo = await fetch(`/api/transactions/${created.id}`, { method: 'DELETE' });
                                if (undo.ok) {
                                    toast('Expense removed', 'info');
                                    void refreshMoneyData();
                                }
                            } catch { /* ignore */ }
                        },
                    },
                } : undefined);
                router.push('/transactions');
            } else {
                const err = await res.json().catch(() => ({}));
                toast(err.error || 'Could not add this expense', 'error');
            }
        } catch {
            toast('Network error — please check your connection', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ── Render ──
    const selectedGroup = groups.find((group) => group.id === selectedGroupId);
    const payerMember = members.find((member) => member.id === payerId);
    const payerName = payerMember ? (payerMember.id === currentUser?.id ? 'You' : payerMember.name.split(' ')[0]) : 'Select';
    const methodData = PAYMENT_METHODS[method] || PAYMENT_METHODS.cash;
    const recentGroups = recentGroupIds
        .map((groupId) => groups.find((group) => group.id === groupId))
        .filter((group): group is GroupItem => Boolean(group))
        .filter((group) => group.id !== selectedGroupId);
    const recentPayers = (recentPayersByGroup[selectedGroupId] || [])
        .map((memberId) => members.find((member) => member.id === memberId))
        .filter((member): member is MemberItem => Boolean(member))
        .filter((member) => member.id !== payerId);
    const allocatedCustom = customPlan ? customPlan.othersTotal + Math.max(0, customPlan.lastAmount) : 0;

    if (loadingGroups || userLoading) {
        return (
            <div className={styles.composer}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Skeleton variant="rectangular" width={170} height={42} radius="var(--radius-full)" />
                </div>
                <Skeleton variant="rectangular" height={150} radius={28} />
                <Skeleton variant="rectangular" height={56} radius={20} />
                <Skeleton variant="rectangular" height={78} radius={18} />
                <Skeleton variant="rectangular" height={240} radius={20} />
            </div>
        );
    }

    if (groups.length === 0) {
        return (
            <div className={styles.composer} style={{ paddingTop: 24 }}>
                <EmptyState
                    icon={<Users size={26} />}
                    title="Create a group first"
                    description="Expenses live inside groups. Set one up for a trip, your flat or friends — it takes five seconds."
                    actionLabel="Create a group"
                    actionHref="/groups?create=1"
                />
            </div>
        );
    }

    return (
        <div className={styles.composer}>
            {/* ── Group ── */}
            <div className={styles.groupRow}>
                <button type="button" className={styles.groupChip} onClick={() => setSheet('group')} aria-label="Change group">
                    <span className={styles.groupEmoji}>{selectedGroup?.emoji || '👥'}</span>
                    <span className={styles.groupChipName}>{selectedGroup?.name || 'Select group'}</span>
                    <ChevronDown size={15} />
                </button>
                {recentGroups.length > 0 && (
                    <div className={styles.recentRow}>
                        {recentGroups.map((group) => (
                            <button key={group.id} type="button" className={styles.recentChip} onClick={() => setSelectedGroupId(group.id)}>
                                <History size={12} />
                                {group.emoji} {group.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {source && SOURCE_COPY[source] && (
                <Notice tone="info" icon={source === 'scan' ? <ScanLine size={16} /> : <ClipboardCheck size={16} />}>
                    {SOURCE_COPY[source]}
                </Notice>
            )}

            {/* ── Amount ── */}
            <section className={styles.amountCard} aria-label="Amount">
                <span className={styles.amountLabel}>Amount</span>
                <div className={styles.amountRow}>
                    <span className={styles.currency}>₹</span>
                    <input
                        className={styles.amountInput}
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={expression || amount}
                        onChange={handleAmountInputChange}
                        onBlur={() => {
                            if (hasOperator && expression) {
                                const result = evaluateExpression(expression);
                                setAmount(result % 1 === 0 ? result.toString() : result.toFixed(2));
                                setExpression('');
                            }
                        }}
                        aria-label="Amount in rupees"
                    />
                </div>
                <AnimatePresence initial={false}>
                    {hasOperator && expression ? (
                        <motion.div
                            key="expr"
                            className={styles.expression}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                        >
                            = {formatCurrency(toPaise(evaluateExpression(expression)))}
                        </motion.div>
                    ) : (
                        <motion.div key="hint" className={styles.expression} style={{ color: 'var(--fg-muted)', fontWeight: 600 }} initial={false}>
                            {selectedCount > 0 && totalPaise > 0 && splitType === 'equal'
                                ? `${formatCurrency(equalShares.get(selectedMemberIds[0]) ?? 0)} each · ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'}`
                                : 'Tip: type 450+120 to add bills'}
                        </motion.div>
                    )}
                </AnimatePresence>
                <motion.button
                    type="button"
                    className={styles.voiceBtn}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => window.dispatchEvent(new CustomEvent('openVoiceInput'))}
                    aria-label="Add by voice"
                >
                    <Mic size={18} />
                </motion.button>
            </section>

            {/* ── Title ── */}
            <label className={styles.titleField}>
                <CategoryTile category={category} size={40} />
                <input
                    className={styles.titleInput}
                    placeholder="What was it for?"
                    value={title}
                    onChange={(event) => handleTitleChange(event.target.value)}
                    maxLength={60}
                    aria-label="Expense title"
                    enterKeyHint="done"
                />
            </label>

            {/* ── Pickers ── */}
            <div className={styles.pickers}>
                <button type="button" className={styles.picker} onClick={() => setSheet('category')}>
                    <span className={styles.pickerLabel}>Category <ChevronDown size={12} /></span>
                    <span className={styles.pickerValue}>
                        <categoryConfig.Icon size={16} style={{ color: categoryConfig.color, flexShrink: 0 }} />
                        <span className={styles.pickerText}>{categoryLabel}</span>
                    </span>
                </button>
                <button type="button" className={styles.picker} onClick={() => setSheet('payer')}>
                    <span className={styles.pickerLabel}>Paid by <ChevronDown size={12} /></span>
                    <span className={styles.pickerValue}>
                        {payerMember && <Avatar name={payerMember.name} image={payerMember.image} size="xs" />}
                        <span className={styles.pickerText}>{payerName}</span>
                    </span>
                </button>
                <button type="button" className={styles.picker} onClick={() => setSheet('method')}>
                    <span className={styles.pickerLabel}>Method <ChevronDown size={12} /></span>
                    <span className={styles.pickerValue}>
                        <PaymentIcon method={method} size={15} />
                        <span className={styles.pickerText}>{methodData.label}</span>
                    </span>
                </button>
            </div>

            {recentPayers.length > 0 && (
                <div className={styles.recentRow}>
                    {recentPayers.map((member) => (
                        <button key={member.id} type="button" className={styles.recentChip} onClick={() => setPayerId(member.id)}>
                            <History size={12} />
                            Paid by {member.id === currentUser?.id ? 'you' : member.name.split(' ')[0]}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Split ── */}
            {members.length > 1 && (
                <section className={styles.card} aria-label="Split">
                    <div className={styles.cardHead}>
                        <span className={styles.cardTitle}>Split between</span>
                        <div className={styles.segWrap}>
                            <Segmented<SplitMode>
                                size="sm"
                                ariaLabel="Split mode"
                                value={splitType}
                                onChange={changeSplitMode}
                                options={[
                                    { value: 'equal', label: 'Equally' },
                                    { value: 'custom', label: 'Custom' },
                                ]}
                            />
                        </div>
                    </div>

                    <div className={styles.members}>
                        {members.map((member) => {
                            const on = selectedMembers.has(member.id);
                            const isPayer = member.id === payerId;
                            return (
                                <motion.button
                                    key={member.id}
                                    type="button"
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => toggleMember(member.id)}
                                    className={cn(styles.member, on ? styles.memberOn : styles.memberOff)}
                                    aria-pressed={on}
                                >
                                    <span className={styles.memberAvatar}>
                                        <Avatar name={member.name} image={member.image} size="sm" />
                                        {on && <span className={styles.memberCheck}><Check size={9} strokeWidth={3.5} /></span>}
                                    </span>
                                    <span className={styles.memberText}>
                                        <span className={styles.memberName}>{member.id === currentUser?.id ? 'You' : member.name.split(' ')[0]}</span>
                                        {on && totalPaise > 0 && <span className={styles.memberShare}>{formatCurrency(shareFor(member.id))}</span>}
                                    </span>
                                    {isPayer && <span className={styles.payerBadge}>PAID</span>}
                                </motion.button>
                            );
                        })}
                    </div>

                    {splitType === 'equal' ? (
                        totalPaise > 0 && (
                            <div className={styles.splitSummary}>
                                <span>{selectedCount} of {members.length} people</span>
                                <span><strong>{formatCurrency(equalShares.get(selectedMemberIds[0]) ?? 0)}</strong> each</span>
                            </div>
                        )
                    ) : (
                        <>
                            <div className={styles.customRows}>
                                {selectedMemberIds.map((memberId) => {
                                    const member = members.find((item) => item.id === memberId);
                                    if (!member) return null;
                                    const isRemainder = customPlan?.lastId === memberId;
                                    const value = isRemainder
                                        ? customPlan?.lastAmount ?? 0
                                        : customSplits.find((split) => split.userId === memberId)?.amount ?? 0;
                                    return (
                                        <div key={memberId} className={styles.customRow}>
                                            <Avatar name={member.name} image={member.image} size="sm" />
                                            <span className={styles.customName}>
                                                {member.id === currentUser?.id ? 'You' : member.name.split(' ')[0]}
                                                {isRemainder && <span className={styles.customHint}>Gets the remainder</span>}
                                            </span>
                                            <label className={cn(styles.customInputWrap, isRemainder && styles.customInputLocked)}>
                                                ₹
                                                <input
                                                    className={styles.customInput}
                                                    type="number"
                                                    inputMode="decimal"
                                                    value={isRemainder ? (value / 100).toFixed(2) : value ? value / 100 : ''}
                                                    readOnly={isRemainder}
                                                    placeholder="0"
                                                    onChange={(event) => {
                                                        const paise = Math.max(0, Math.round(parseFloat(event.target.value || '0') * 100));
                                                        setCustomSplits((prev) => {
                                                            const exists = prev.some((split) => split.userId === memberId);
                                                            return exists
                                                                ? prev.map((split) => split.userId === memberId ? { ...split, amount: paise } : split)
                                                                : [...prev, { userId: memberId, amount: paise }];
                                                        });
                                                    }}
                                                    aria-label={`Amount for ${member.name}`}
                                                />
                                            </label>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className={styles.allocation}>
                                <Progress
                                    value={totalPaise > 0 ? (allocatedCustom / totalPaise) * 100 : 0}
                                    tone={customPlan?.overAllocated ? 'danger' : allocatedCustom === totalPaise ? 'success' : 'accent'}
                                />
                                <span
                                    className={styles.allocationText}
                                    style={{ color: customPlan?.overAllocated ? 'var(--color-error)' : 'var(--color-success)' }}
                                >
                                    {customPlan?.overAllocated
                                        ? `Over by ${formatCurrency(Math.abs(customPlan.lastAmount))} — lower someone’s share`
                                        : `${formatCurrency(totalPaise)} fully allocated`}
                                </span>
                            </div>
                        </>
                    )}
                </section>
            )}

            {/* ── Impact preview ── */}
            {impactPreview.length > 0 && (
                <section className={styles.card} aria-label="Balance impact">
                    <div className={styles.cardHead}>
                        <span className={styles.cardTitle}>How balances change</span>
                        <TrendingUp size={16} style={{ color: 'var(--accent-strong)' }} />
                    </div>
                    <div>
                        {impactPreview.map((entry) => (
                            <div key={entry.memberId} className={styles.impactRow}>
                                <span className={styles.impactName}>
                                    <Avatar name={entry.fullName} image={entry.image} size="xs" />
                                    {entry.name}
                                </span>
                                <span
                                    className={styles.impactValue}
                                    style={{ color: entry.delta > 0 ? 'var(--color-success)' : 'var(--color-error)' }}
                                >
                                    {entry.delta > 0 ? 'gets back ' : 'owes '}
                                    {formatCurrency(Math.abs(entry.delta))}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {duplicateCandidates.length > 0 && (
                <Notice tone="warning" icon={<AlertTriangle size={16} />} title="Possible duplicate">
                    A matching expense was added recently. Tap Add again only if this is a real second charge.
                    <div className={styles.duplicateList}>
                        {duplicateCandidates.map((transaction) => (
                            <div key={transaction.id} className={styles.duplicateItem}>
                                <strong>{transaction.title} · {formatCurrency(transaction.amount)}</strong>
                                {' — '}paid by {transaction.payer.name || 'someone'}, {new Date(transaction.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                            </div>
                        ))}
                    </div>
                </Notice>
            )}

            {/* ── Numpad ── */}
            <div className={styles.numpad} aria-label="Number pad">
                {NUMPAD_KEYS.map((key) => (
                    <motion.button
                        key={key}
                        type="button"
                        className={cn(
                            styles.key,
                            (key === '+' || key === '-') && styles.keyOp,
                            key === 'del' && styles.keyDel,
                            key === '=' && styles.keyEq,
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
                        aria-label={key === 'del' ? 'Delete' : key === '=' ? 'Calculate' : key === '+' ? 'Plus' : key === '-' ? 'Minus' : key}
                    >
                        {key === 'del' ? <Delete size={21} />
                            : key === '+' ? <Plus size={20} />
                                : key === '-' ? <Minus size={20} />
                                    : key === '=' ? <Equal size={20} />
                                        : key}
                    </motion.button>
                ))}
            </div>

            {/* ── Submit ── */}
            <div className={styles.submitBar}>
                <Button
                    fullWidth
                    size="xl"
                    disabled={!numericAmount || Boolean(customPlan?.overAllocated)}
                    loading={saving}
                    leftIcon={<Check size={19} />}
                    onClick={handleSave}
                >
                    {numericAmount > 0 ? `Add ${formatCurrency(totalPaise)}` : 'Add expense'}
                </Button>
            </div>

            <VoiceInput
                memberNames={members.map((member) => member.name)}
                members={members.map((member) => ({ name: member.name, image: member.image }))}
                groupName={selectedGroup?.name || 'Group'}
                onResult={handleVoiceResult}
            />

            {/* ── Group picker ── */}
            <Modal isOpen={sheet === 'group'} onClose={() => setSheet(null)} title="Choose a group" size="small">
                <div className={styles.optionList}>
                    {groups.map((group) => (
                        <button
                            key={group.id}
                            type="button"
                            className={cn(styles.option, selectedGroupId === group.id && styles.optionActive)}
                            onClick={() => { setSelectedGroupId(group.id); setSheet(null); }}
                        >
                            <span className={styles.optionIcon}>{group.emoji}</span>
                            <span className={styles.optionText}>{group.name}</span>
                            {selectedGroupId === group.id && <Check size={18} className={styles.optionCheck} />}
                        </button>
                    ))}
                </div>
            </Modal>

            {/* ── Category picker ── */}
            <Modal
                isOpen={sheet === 'category'}
                onClose={() => { setSheet(null); setIsCustomCategory(false); }}
                title={isCustomCategory ? 'Custom category' : 'Category'}
                size="small"
            >
                {isCustomCategory ? (
                    <div className={styles.sheetStack}>
                        <label className={styles.titleField}>
                            <span style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 13, background: 'var(--bg-tertiary)' }}>
                                <PencilLine size={18} />
                            </span>
                            <input
                                className={styles.titleInput}
                                autoFocus
                                placeholder="e.g. Scuba diving"
                                value={customCatValue}
                                onChange={(event) => setCustomCatValue(event.target.value)}
                                maxLength={30}
                            />
                        </label>
                        <Button
                            fullWidth
                            size="lg"
                            disabled={!customCatValue.trim()}
                            onClick={() => {
                                setCategory(customCatValue.trim());
                                setCategoryTouched(true);
                                setSheet(null);
                                setIsCustomCategory(false);
                            }}
                        >
                            Use this category
                        </Button>
                        <Button fullWidth variant="ghost" onClick={() => { setIsCustomCategory(false); setCustomCatValue(''); }}>
                            Back to categories
                        </Button>
                    </div>
                ) : (
                    <div className={styles.categoryGrid}>
                        {Object.entries(CATEGORIES).filter(([key]) => key !== 'other').map(([key, value]) => (
                            <motion.button
                                key={key}
                                type="button"
                                className={cn(styles.categoryItem, category === key && styles.categoryItemActive)}
                                whileTap={{ scale: 0.94 }}
                                onClick={() => {
                                    setCategory(key);
                                    setCategoryTouched(true);
                                    setSheet(null);
                                }}
                            >
                                <CategoryTile category={key} size={42} />
                                <span className={styles.categoryLabel}>{value.label}</span>
                            </motion.button>
                        ))}
                        <button type="button" className={styles.customCategory} onClick={() => setIsCustomCategory(true)}>
                            <PencilLine size={16} /> Something else…
                        </button>
                    </div>
                )}
            </Modal>

            {/* ── Payer picker ── */}
            <Modal isOpen={sheet === 'payer'} onClose={() => setSheet(null)} title="Who paid?" size="small">
                <div className={styles.optionList}>
                    {members.map((member) => (
                        <button
                            key={member.id}
                            type="button"
                            className={cn(styles.option, payerId === member.id && styles.optionActive)}
                            onClick={() => { setPayerId(member.id); setSheet(null); }}
                        >
                            <Avatar name={member.name} image={member.image} size="md" />
                            <span className={styles.optionText}>
                                {member.id === currentUser?.id ? `${member.name} (you)` : member.name}
                            </span>
                            {payerId === member.id && <Check size={18} className={styles.optionCheck} />}
                        </button>
                    ))}
                </div>
            </Modal>

            {/* ── Method picker ── */}
            <Modal isOpen={sheet === 'method'} onClose={() => setSheet(null)} title="Payment method" size="small">
                <div className={styles.optionList}>
                    {Object.entries(PAYMENT_METHODS).map(([key, value]) => (
                        <button
                            key={key}
                            type="button"
                            className={cn(styles.option, method === key && styles.optionActive)}
                            onClick={() => { setMethod(key); setSheet(null); }}
                        >
                            <span className={styles.optionIcon}><PaymentIcon method={key} size={20} /></span>
                            <span className={styles.optionText}>{value.label}</span>
                            {method === key && <Check size={18} className={styles.optionCheck} />}
                        </button>
                    ))}
                </div>
            </Modal>
        </div>
    );
}

export default function QuickAddPage() {
    return (
        <Suspense fallback={
            <div className={styles.composer}>
                <Skeleton variant="rectangular" height={150} radius={28} />
            </div>
        }>
            <QuickAddContent />
        </Suspense>
    );
}
