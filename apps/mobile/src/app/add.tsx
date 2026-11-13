/**
 * Adding an expense: the amount on a keypad under the thumb, what it was for (the category is
 * guessed from that), the group, who paid, and how it splits: equally among the people you pick,
 * by exact amounts, or by percentages. Every split goes through the website's own rules
 * (resolveSplits), so the app can never save one the server would refuse.
 */
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { inferCategory } from '@/lib/categoryInference';
import { resolveSplits, type SplitRequest, type SplitType } from '@/lib/expenseSplits';
import { ME, personById } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { FONT } from '~/theme/type';
import { CATEGORY_IDS, categoryEmoji, categoryLabel } from '~/ui/category';
import { Chips } from '~/ui/Chips';
import { Field } from '~/ui/Field';
import { GlassButton, tap } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Keypad } from '~/ui/Keypad';
import { rupees } from '~/ui/money';
import { Avatar } from '~/ui/Avatar';
import { Screen } from '~/ui/Screen';
import { Segmented } from '~/ui/Segmented';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

type Share = { userId: string; amount: number };

/** "1,234.5" → 123450 paise; anything that isn't a number is nothing. */
const toPaise = (text: string | undefined) => {
    const value = Number((text ?? '').replace(/,/g, ''));
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
};

/** Keeps what's typed to digits and one dot, at most two places after it. */
const decimal = (text: string) => {
    const [whole = '', ...rest] = text.replace(/[^0-9.]/g, '').split('.');
    return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
};

/** Percentages into paise that add up exactly, the leftover paise going to the largest remainders. */
function percentShares(amount: number, percents: { userId: string; percent: number }[]): Share[] {
    const parts = percents.map(({ userId, percent }) => {
        const exact = (amount * percent) / 100;
        return { userId, amount: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let left = amount - parts.reduce((sum, part) => sum + part.amount, 0);
    for (const part of [...parts].sort((a, b) => b.remainder - a.remainder)) {
        if (left <= 0) break;
        part.amount += 1;
        left -= 1;
    }
    return parts.map(({ userId, amount: share }) => ({ userId, amount: share }));
}

/** An even start for exact amounts or percentages, so a new split already adds up. */
function evenly(memberIds: string[], amount: number, type: SplitType): Record<string, string> {
    if (type === 'percentage') {
        const base = Math.floor(10_000 / memberIds.length) / 100;
        const last = Math.round((100 - base * (memberIds.length - 1)) * 100) / 100;
        return Object.fromEntries(memberIds.map((id, index) => [id, String(index === memberIds.length - 1 ? last : base)]));
    }
    const resolved = resolveSplits({ amount, splitType: 'equal' }, memberIds);
    if (!resolved.ok) return {};
    return Object.fromEntries(resolved.splits.map((share) => [share.userId, String(share.amount / 100)]));
}

export default function AddExpense() {
    const params = useLocalSearchParams<{ group?: string }>();
    const { tokens } = useLook();
    const { ledger, addExpense } = useLedger();
    const toast = useToast();

    const [groupId, setGroupId] = useState(() => (ledger.groups.some((candidate) => candidate.id === params.group) ? params.group! : ledger.groups[0].id));
    const group = ledger.groups.find((candidate) => candidate.id === groupId) ?? ledger.groups[0];
    const [amount, setAmount] = useState('');
    const [title, setTitle] = useState('');
    const [picked, setPicked] = useState<string | null>(null);
    const [choosingCategory, setChoosingCategory] = useState(false);
    const [payerId, setPayerId] = useState(ME);
    const [splitType, setSplitType] = useState<SplitType>('equal');
    const [among, setAmong] = useState<string[]>(group.memberIds);
    const [typed, setTyped] = useState<Record<string, string>>({});

    const paise = toPaise(amount);
    const guessed = inferCategory(title);
    const category = picked ?? guessed ?? 'general';
    const firstName = (id: string) => (id === ME ? 'You' : personById(id).first);

    const chooseGroup = (id: string) => {
        const next = ledger.groups.find((candidate) => candidate.id === id);
        if (!next) return;
        setGroupId(id);
        setPayerId(ME);
        setAmong(next.memberIds);
        setTyped(splitType === 'equal' ? {} : evenly(next.memberIds, paise, splitType));
    };

    const chooseSplit = (type: SplitType) => {
        setSplitType(type);
        setTyped(type === 'equal' ? {} : evenly(group.memberIds, paise, type));
    };

    /** The split as it stands: whether it can be saved, what to say about it, and each share. */
    const split = useMemo((): { ok: boolean; note: string; shares: Share[] } => {
        if (paise <= 0) return { ok: false, note: 'Type the amount on the keypad', shares: [] };
        let request: SplitRequest;
        if (splitType === 'equal') {
            if (among.length === 0) return { ok: false, note: 'Pick at least one person to share it', shares: [] };
            request = { amount: paise, splitType, splitAmong: group.memberIds.filter((id) => among.includes(id)) };
        } else if (splitType === 'custom') {
            const shares = group.memberIds.map((id) => ({ userId: id, amount: toPaise(typed[id]) }));
            const total = shares.reduce((sum, share) => sum + share.amount, 0);
            if (total < paise) return { ok: false, note: `${rupees(paise - total)} still to share out`, shares };
            if (total > paise) return { ok: false, note: `${rupees(total - paise)} more than the expense`, shares };
            request = { amount: paise, splitType, splits: shares };
        } else {
            const percents = group.memberIds.map((id) => ({ userId: id, percent: Number(typed[id] || 0) }));
            const total = Math.round(percents.reduce((sum, entry) => sum + entry.percent, 0) * 100) / 100;
            if (total !== 100) return { ok: false, note: `${total}% of 100% shared out`, shares: percentShares(paise, percents) };
            request = { amount: paise, splitType, splits: percentShares(paise, percents) };
        }
        const resolved = resolveSplits(request, group.memberIds);
        return resolved.ok ? { ok: true, note: 'Adds up exactly', shares: resolved.splits } : { ok: false, note: resolved.error, shares: [] };
    }, [paise, splitType, among, typed, group.memberIds]);

    const shareOf = (id: string) => split.shares.find((share) => share.userId === id)?.amount ?? 0;

    const save = () => {
        if (!split.ok) return;
        try {
            addExpense({
                groupId: group.id,
                title: title.trim() || categoryLabel(category),
                category,
                amount: paise,
                payerId,
                splitType,
                among: splitType === 'equal' ? group.memberIds.filter((id) => among.includes(id)) : undefined,
                shares: splitType === 'equal' ? undefined : split.shares,
            });
        } catch (error) {
            toast(error instanceof Error ? error.message : 'That expense could not be saved', 'info');
            return;
        }
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        toast(`Added to ${group.name}`);
        if (router.canGoBack()) router.back();
        else router.replace(`/group/${group.id}`);
    };

    const shown = amount ? Number(amount.endsWith('.') ? amount.slice(0, -1) : amount).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (amount.endsWith('.') ? '.' : '') : '0';

    return (
        <Screen tabBar={false}>
            <Header title="New expense" eyebrow={`${group.emoji} ${group.name}`} close />

            <View style={{ alignItems: 'center', paddingTop: 4 }}>
                <Text onLiquid tabular numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={`Amount ${rupees(paise)}`} style={{ fontSize: 64, lineHeight: 74, letterSpacing: -2.4, fontFamily: FONT.medium }}>
                    <Text tone="secondary" style={{ fontSize: 40, lineHeight: 74, fontFamily: FONT.medium }}>
                        ₹
                    </Text>
                    {shown}
                </Text>
            </View>

            <Keypad value={amount} onChange={setAmount} />

            <Field label="What was it for?" value={title} onChangeText={setTitle} returnKeyType="done" />

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Category ${categoryLabel(category)}. Change`}
                onPress={() => {
                    tap();
                    setChoosingCategory((open) => !open);
                }}
                style={{ alignSelf: 'center' }}
            >
                <GlassSurface kind="thin" radius={999} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 16 }}>
                    <Text style={{ fontSize: 16, lineHeight: 20 }}>{categoryEmoji(category)}</Text>
                    <Text variant="label">{categoryLabel(category)}</Text>
                    <Text variant="caption" tone="muted">
                        {picked ? '· your pick' : guessed ? '· guessed' : '· change'}
                    </Text>
                </GlassSurface>
            </Pressable>
            {choosingCategory ? (
                <Chips
                    label="Category"
                    options={CATEGORY_IDS.map((id) => ({ id, label: categoryLabel(id), emoji: categoryEmoji(id) }))}
                    value={category}
                    onChange={(id) => {
                        setPicked(id);
                        setChoosingCategory(false);
                    }}
                />
            ) : null}

            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Group
                </Text>
                <Chips label="Group" options={ledger.groups.map((candidate) => ({ id: candidate.id, label: candidate.name, emoji: candidate.emoji }))} value={group.id} onChange={chooseGroup} />
            </View>

            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Paid by
                </Text>
                <Chips label="Paid by" options={group.memberIds.map((id) => ({ id, label: firstName(id) }))} value={payerId} onChange={setPayerId} />
            </View>

            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Split
                </Text>
                <Segmented<SplitType>
                    compact
                    options={[
                        { id: 'equal', label: 'Equally' },
                        { id: 'custom', label: 'Exact ₹' },
                        { id: 'percentage', label: 'Percent' },
                    ]}
                    value={splitType}
                    onChange={chooseSplit}
                />
                <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                    {group.memberIds.map((id, index) => {
                        const included = among.includes(id);
                        const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 12, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border };
                        const name = (
                            <>
                                <Avatar name={personById(id).name} size={34} />
                                <Text variant="label" align="left" style={{ flex: 1 }} numberOfLines={1}>
                                    {firstName(id)}
                                </Text>
                            </>
                        );
                        if (splitType === 'equal') {
                            return (
                                <Pressable
                                    key={id}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked: included }}
                                    accessibilityLabel={`${firstName(id)} shares it`}
                                    onPress={() => {
                                        tap();
                                        setAmong((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
                                    }}
                                    style={row}
                                >
                                    {name}
                                    <Text variant="label" tabular tone={included ? 'primary' : 'muted'}>
                                        {included ? rupees(shareOf(id)) : 'Not in it'}
                                    </Text>
                                    <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: included ? tokens.accent : 'transparent', borderWidth: included ? 0 : 1.5, borderColor: tokens.borderStrong }}>
                                        {included ? <Check size={16} color={tokens.onAccent} strokeWidth={3} /> : null}
                                    </View>
                                </Pressable>
                            );
                        }
                        const percent = splitType === 'percentage';
                        return (
                            <View key={id} style={row}>
                                {name}
                                {percent ? (
                                    <Text variant="caption" tone="secondary" tabular>
                                        {rupees(shareOf(id))}
                                    </Text>
                                ) : null}
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 104, height: 40, paddingHorizontal: 12, borderRadius: 14, backgroundColor: tokens.chip }}>
                                    {percent ? null : (
                                        <Text variant="label" tone="secondary">
                                            ₹
                                        </Text>
                                    )}
                                    <TextInput
                                        value={typed[id] ?? ''}
                                        onChangeText={(text) => setTyped((current) => ({ ...current, [id]: decimal(text) }))}
                                        keyboardType="decimal-pad"
                                        placeholder="0"
                                        placeholderTextColor={tokens.muted}
                                        accessibilityLabel={percent ? `${firstName(id)}'s percentage` : `${firstName(id)}'s amount in rupees`}
                                        maxLength={percent ? 6 : 10}
                                        style={{ flex: 1, color: tokens.fg, fontFamily: FONT.semibold, fontSize: 15, textAlign: 'right', fontVariant: ['tabular-nums'], padding: 0 }}
                                    />
                                    {percent ? (
                                        <Text variant="label" tone="secondary">
                                            %
                                        </Text>
                                    ) : null}
                                </View>
                            </View>
                        );
                    })}
                </GlassSurface>
                <Text variant="caption" tone={split.ok ? 'in' : 'secondary'} onLiquid accessibilityLiveRegion="polite">
                    {split.note}
                </Text>
            </View>

            <GlassButton kind="accent" contentStyle={{ height: 58 }} disabled={!split.ok} onPress={save} accessibilityLabel="Save expense">
                <Text variant="heading" tone="onAccent">
                    {paise > 0 ? `Save ${rupees(paise)}` : 'Save expense'}
                </Text>
            </GlassButton>
        </Screen>
    );
}
