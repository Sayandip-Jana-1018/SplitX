/**
 * Adding an expense: a big amount, a keypad of glass under the thumb, what it was for, and the
 * group. Saving to the server arrives in Phase 3; for now it shows how entering feels.
 */
import { router } from 'expo-router';
import { Delete, X } from 'lucide-react-native';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { GROUPS } from '~/data/demo';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { FONT } from '~/theme/type';
import { GlassButton } from '~/ui/GlassButton';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

/** Typing an amount the way a keypad should: one dot, two decimals, no leading zeros. */
function press(current: string, key: (typeof KEYS)[number]): string {
    if (key === 'back') return current.slice(0, -1);
    if (key === '.') return current.includes('.') ? current : `${current || '0'}.`;
    const [, decimals] = current.split('.');
    if (decimals !== undefined && decimals.length >= 2) return current;
    if (current === '0') return key;
    if (current.replace('.', '').length >= 9) return current;
    return current + key;
}

export default function AddExpense() {
    const { tokens } = useLook();
    const [amount, setAmount] = useState('');
    const [what, setWhat] = useState('');
    const [groupId, setGroupId] = useState(GROUPS[0].id);
    const value = Number(amount || '0');
    const shown = amount ? Number(amount.endsWith('.') ? amount.slice(0, -1) : amount).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (amount.endsWith('.') ? '.' : '') : '0';

    return (
        <Screen tabBar={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="title" onLiquid>
                    New expense
                </Text>
                <View style={{ position: 'absolute', right: 0 }}>
                    <GlassButton kind="thin" contentStyle={{ width: 42, height: 42 }} accessibilityLabel="Close" onPress={() => router.back()}>
                        <X size={20} color={tokens.fg} />
                    </GlassButton>
                </View>
            </View>

            <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Amount
                </Text>
                <Text onLiquid tabular numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 64, lineHeight: 74, letterSpacing: -2.4, fontFamily: FONT.medium }}>
                    <Text tone="secondary" style={{ fontSize: 40, lineHeight: 74, fontFamily: FONT.medium }}>
                        ₹
                    </Text>
                    {shown}
                </Text>
            </View>

            <GlassSurface kind="thin" radius={22} style={{ paddingHorizontal: 18 }}>
                <TextInput
                    value={what}
                    onChangeText={setWhat}
                    placeholder="What was it for?"
                    placeholderTextColor={tokens.muted}
                    style={{ height: 54, color: tokens.fg, fontFamily: FONT.semibold, fontSize: 16, textAlign: 'center' }}
                    returnKeyType="done"
                    maxLength={80}
                />
            </GlassSurface>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {GROUPS.map((group) => {
                    const selected = group.id === groupId;
                    return (
                        <GlassButton key={group.id} kind={selected ? 'accent' : 'thin'} contentStyle={{ paddingHorizontal: 14, height: 38, flexDirection: 'row', gap: 6 }} onPress={() => setGroupId(group.id)}>
                            <Text style={{ fontSize: 15, lineHeight: 20 }}>{group.emoji}</Text>
                            <Text variant="caption" weight="bold" tone={selected ? 'onAccent' : 'primary'}>
                                {group.name}
                            </Text>
                        </GlassButton>
                    );
                })}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
                {KEYS.map((key) => (
                    <GlassButton key={key} kind="thin" radius={22} style={{ width: '30.5%' }} contentStyle={{ height: 62 }} accessibilityLabel={key === 'back' ? 'Delete' : key} onPress={() => setAmount((current) => press(current, key))}>
                        {key === 'back' ? (
                            <Delete size={24} color={tokens.fg} strokeWidth={2} />
                        ) : (
                            <Text variant="title" weight="semibold">
                                {key}
                            </Text>
                        )}
                    </GlassButton>
                ))}
            </View>

            <GlassButton kind="accent" contentStyle={{ height: 58 }} disabled={value <= 0} onPress={() => router.back()}>
                <Text variant="heading" tone="onAccent">
                    Save expense
                </Text>
            </GlassButton>
        </Screen>
    );
}
