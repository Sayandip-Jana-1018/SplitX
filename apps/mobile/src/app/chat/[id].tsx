/**
 * A group's chat, with its expenses and payments in the same timeline, the way a group remembers
 * a trip. The bubbles are plain tinted views, not glass: a long chat would otherwise be dozens of
 * canvases on the GPU. The box you type in is glass, and stays above the keyboard.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { SendHorizontal } from 'lucide-react-native';
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ME } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { GlassLayer } from '~/glass/layer';
import { useLook } from '~/theme/ThemeProvider';
import { FONT } from '~/theme/type';
import { Avatar } from '~/ui/Avatar';
import { categoryEmoji } from '~/ui/category';
import { tap } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { rupees } from '~/ui/money';
import { Text } from '~/ui/Text';

type Entry =
    | { kind: 'message'; id: string; fromId: string; text: string; at: Date }
    | { kind: 'expense'; id: string; text: string; emoji: string; at: Date }
    | { kind: 'payment'; id: string; text: string; at: Date };

const dayOf = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();

function dayLabel(at: Date): string {
    const days = Math.round((dayOf(new Date()) - dayOf(at)) / 86_400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return at.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

const clock = (at: Date) => at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();

export default function Chat() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { tokens } = useLook();
    const insets = useSafeAreaInsets();
    const { ledger, personOf, sendMessage } = useLedger();
    const [draft, setDraft] = useState('');
    const list = useRef<ComponentRef<typeof ScrollView>>(null);
    const group = ledger.groups.find((candidate) => candidate.id === id);

    const entries = useMemo((): Entry[] => {
        if (!group) return [];
        const first = (who: string) => (who === ME ? 'You' : personOf(who).first);
        const all: Entry[] = [
            ...ledger.messages.filter((message) => message.groupId === group.id).map((message) => ({ kind: 'message' as const, id: message.id, fromId: message.fromId, text: message.text, at: message.at })),
            ...ledger.expenses
                .filter((expense) => expense.groupId === group.id)
                .map((expense) => ({ kind: 'expense' as const, id: expense.id, emoji: categoryEmoji(expense.category), text: `${first(expense.payerId)} added ${expense.title} · ${rupees(expense.amount)}`, at: expense.createdAt })),
            ...ledger.settlements
                .filter((settlement) => settlement.groupId === group.id)
                .map((settlement) => ({ kind: 'payment' as const, id: settlement.id, text: `${first(settlement.fromId)} paid ${settlement.toId === ME ? 'you' : personOf(settlement.toId).first} ${rupees(settlement.amount)}`, at: settlement.createdAt })),
        ];
        return all.sort((a, b) => a.at.getTime() - b.at.getTime());
    }, [ledger, group, personOf]);

    const send = () => {
        const text = draft.trim();
        if (!text || !group) return;
        tap();
        sendMessage(group.id, text);
        setDraft('');
    };

    return (
        <GlassLayer style={{ flex: 1 }}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
                <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 8 }}>
                    <Header title={group ? `${group.emoji} ${group.name}` : 'Chat'} eyebrow="Group chat" />
                </View>

                <ScrollView ref={list} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }} onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
                    {entries.map((entry, index) => {
                        const before = entries[index - 1];
                        const after = entries[index + 1];
                        const newDay = !before || dayOf(before.at) !== dayOf(entry.at);
                        const day = newDay ? (
                            <View key={`${entry.id}-day`} style={{ alignItems: 'center', paddingTop: index === 0 ? 0 : 14, paddingBottom: 6 }}>
                                <Text variant="eyebrow" tone="secondary" onLiquid>
                                    {dayLabel(entry.at)}
                                </Text>
                            </View>
                        ) : null;

                        if (entry.kind !== 'message') {
                            return (
                                <View key={entry.id}>
                                    {day}
                                    <Pressable
                                        disabled={entry.kind !== 'expense'}
                                        accessibilityRole={entry.kind === 'expense' ? 'button' : undefined}
                                        onPress={() => router.push(`/expense/${entry.id}`)}
                                        style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '88%', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: pressed ? tokens.borderStrong : tokens.chip, borderWidth: 1, borderColor: tokens.border, marginVertical: 4 })}
                                    >
                                        <Text style={{ fontSize: 14, lineHeight: 18 }}>{entry.kind === 'expense' ? entry.emoji : '✅'}</Text>
                                        <Text variant="caption" weight="semibold" numberOfLines={2} style={{ flexShrink: 1 }}>
                                            {entry.text}
                                        </Text>
                                    </Pressable>
                                </View>
                            );
                        }

                        const mine = entry.fromId === ME;
                        const sameAsBefore = before?.kind === 'message' && before.fromId === entry.fromId && !newDay;
                        const sameAsAfter = after?.kind === 'message' && after.fromId === entry.fromId && dayOf(after.at) === dayOf(entry.at);
                        const person = personOf(entry.fromId);
                        return (
                            <View key={entry.id}>
                                {day}
                                <View style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8, marginTop: sameAsBefore ? 0 : 6 }}>
                                    {mine ? null : <View style={{ width: 30 }}>{sameAsAfter ? null : <Avatar name={person.name} size={30} />}</View>}
                                    <View
                                        style={{
                                            maxWidth: '78%',
                                            paddingVertical: 9,
                                            paddingHorizontal: 14,
                                            borderRadius: 20,
                                            borderBottomRightRadius: mine && !sameAsAfter ? 6 : 20,
                                            borderBottomLeftRadius: !mine && !sameAsAfter ? 6 : 20,
                                            backgroundColor: mine ? tokens.accent : tokens.chip,
                                            borderWidth: mine ? 0 : 1,
                                            borderColor: tokens.border,
                                            gap: 2,
                                        }}
                                    >
                                        {mine || sameAsBefore ? null : (
                                            <Text variant="caption" weight="bold" tone="accent" align="left">
                                                {person.first}
                                            </Text>
                                        )}
                                        <Text variant="body" align="left" tone={mine ? 'onAccent' : 'primary'}>
                                            {entry.text}
                                        </Text>
                                        <Text variant="caption" align="right" tone={mine ? 'onAccent' : 'muted'} style={{ opacity: mine ? 0.75 : 1, fontSize: 11 }}>
                                            {clock(entry.at)}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        );
                    })}
                </ScrollView>

                <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: insets.bottom + 10 }}>
                    <GlassSurface kind="thick" radius={28} style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 6, gap: 6 }}>
                        <TextInput
                            value={draft}
                            onChangeText={setDraft}
                            placeholder={group ? `Message ${group.name}` : 'Message'}
                            placeholderTextColor={tokens.muted}
                            accessibilityLabel="Message"
                            multiline
                            maxLength={500}
                            style={{ flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 11, color: tokens.fg, fontFamily: FONT.medium, fontSize: 16 }}
                        />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Send"
                            disabled={!draft.trim()}
                            onPress={send}
                            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.accent, opacity: draft.trim() ? (pressed ? 0.8 : 1) : 0.4 })}
                        >
                            <SendHorizontal size={20} color={tokens.onAccent} strokeWidth={2.4} />
                        </Pressable>
                    </GlassSurface>
                </View>
            </KeyboardAvoidingView>
        </GlassLayer>
    );
}
