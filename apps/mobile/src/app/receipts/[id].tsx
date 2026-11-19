/**
 * A group's receipts, as on the website's gallery: every expense with a photo, newest first, three
 * to a row. Tap one for its expense. Photos taken on this phone show offline; the others need the
 * server's link, which comes when online.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { ME } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { onPhone, useReceiptLinks } from '~/data/receipts';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { categoryEmoji } from '~/ui/category';
import { EmptyState } from '~/ui/EmptyState';
import { Header } from '~/ui/Header';
import { rupees } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

const GAP = 8;

export default function Receipts() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { tokens } = useLook();
    const { ledger, personOf } = useLedger();
    const group = ledger.groups.find((candidate) => candidate.id === id);
    const links = useReceiptLinks(group?.id);
    const [width, setWidth] = useState(0);
    const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());

    const withPhotos = useMemo(
        () => ledger.expenses.filter((expense) => expense.groupId === id && expense.receipt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        [ledger.expenses, id],
    );
    const total = withPhotos.reduce((sum, expense) => sum + expense.amount, 0);
    const side = width > 0 ? (width - GAP * 2) / 3 : 0;

    if (!group) {
        return (
            <Screen tabBar={false}>
                <Header title="Receipts" />
                <EmptyState emoji="🧭" title="This group isn't here" hint="It may have been deleted." />
            </Screen>
        );
    }

    return (
        <Screen tabBar={false}>
            <Header title="Receipts" eyebrow={`${group.emoji} ${group.name}`} />
            {withPhotos.length === 0 ? (
                <EmptyState emoji="📷" title="No receipts yet" hint="Open an expense and add a photo of its bill, and it shows here." />
            ) : (
                <>
                    <Text variant="caption" tone="secondary" onLiquid tabular>
                        {withPhotos.length === 1 ? '1 receipt' : `${withPhotos.length} receipts`} · {rupees(total)}
                    </Text>
                    <View onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                        {side > 0 &&
                            withPhotos.map((expense) => {
                                const uri = onPhone(expense.receipt) ? expense.receipt : links[expense.id];
                                const payer = expense.payerId === ME ? 'You' : personOf(expense.payerId).first;
                                return (
                                    <Pressable
                                        key={expense.id}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${expense.title}, ${rupees(expense.amount)}, ${payer} paid. Open`}
                                        onPress={() => router.push(`/expense/${expense.id}`)}
                                        style={{ width: side }}
                                    >
                                        <GlassSurface kind="thin" radius={18} style={{ height: side, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                                            {uri && !broken.has(expense.id) ? (
                                                <Image
                                                    source={{ uri }}
                                                    resizeMode="cover"
                                                    onError={() => setBroken((current) => new Set(current).add(expense.id))}
                                                    style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 18 }}
                                                />
                                            ) : (
                                                <View style={{ alignItems: 'center', gap: 4, paddingHorizontal: 6 }}>
                                                    <Text style={{ fontSize: 24, lineHeight: 30 }}>{categoryEmoji(expense.category)}</Text>
                                                    <Text variant="caption" tone="muted" numberOfLines={2}>
                                                        {uri ? 'Can’t open' : 'Online to see'}
                                                    </Text>
                                                </View>
                                            )}
                                        </GlassSurface>
                                        <View style={{ paddingTop: 6, paddingHorizontal: 2, gap: 1 }}>
                                            <Text variant="caption" weight="semibold" numberOfLines={1}>
                                                {expense.title}
                                            </Text>
                                            <Text variant="caption" tone="secondary" tabular numberOfLines={1} style={{ color: tokens.fg2 }}>
                                                {rupees(expense.amount)}
                                            </Text>
                                        </View>
                                    </Pressable>
                                );
                            })}
                    </View>
                </>
            )}
        </Screen>
    );
}
