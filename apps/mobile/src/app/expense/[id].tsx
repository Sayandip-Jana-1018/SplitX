/**
 * One expense: what it was, who paid, what it meant for you, each person's share and how it was
 * split, its receipt, and a way to delete it. Editing arrives with accounts in Phase 3.
 */
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Image as ImageIcon, Receipt, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { ME, type Expense } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Avatar } from '~/ui/Avatar';
import { categoryEmoji, categoryLabel } from '~/ui/category';
import { EmptyState } from '~/ui/EmptyState';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { rupees } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Sheet } from '~/ui/Sheet';
import { Skeleton } from '~/ui/Skeleton';
import { Text } from '~/ui/Text';
import { when } from '~/ui/time';
import { useToast } from '~/ui/Toast';

function howSplit(expense: Expense, members: number): string {
    if (expense.weights) return 'by shares';
    if (expense.splitType === 'percentage') return 'by percentages';
    if (expense.splitType === 'custom') return 'by exact amounts';
    return expense.splits.length === members ? 'equally among everyone' : `equally among ${expense.splits.length}`;
}

export default function ExpenseScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { tokens } = useLook();
    const { ledger, personOf, deleteExpense, setReceipt } = useLedger();
    const toast = useToast();
    const [asking, setAsking] = useState<'delete' | 'receipt' | null>(null);
    const [photoReady, setPhotoReady] = useState(false);
    // The phone may clear a picked photo from its cache; then say so rather than show an empty box.
    const [photoGone, setPhotoGone] = useState(false);
    const expense = ledger.expenses.find((candidate) => candidate.id === id);

    if (!expense) {
        return (
            <Screen tabBar={false}>
                <Header title="Expense" />
                <EmptyState emoji="🧾" title="This expense isn't here" hint="It may have been deleted." />
            </Screen>
        );
    }

    const group = ledger.groups.find((candidate) => candidate.id === expense.groupId);
    const payer = expense.payerId === ME ? 'You' : personOf(expense.payerId).first;
    const share = expense.splits.find((split) => split.userId === ME)?.amount ?? 0;
    const paid = expense.payerId === ME ? expense.amount : 0;
    const effect = paid - share;
    /** The group's own order, which starts with you. */
    const order = (userId: string) => group?.memberIds.indexOf(userId) ?? 0;

    const pick = async (from: 'camera' | 'photos') => {
        setAsking(null);
        if (from === 'camera') {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
                toast('Camera access is off. You can turn it on in Settings.', 'info');
                return;
            }
        }
        const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
        const result = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
        if (result.canceled || !result.assets?.[0]) return;
        setPhotoReady(false);
        setPhotoGone(false);
        setReceipt(expense.id, result.assets[0].uri);
        toast('Receipt attached');
    };

    /** Leaves first and deletes once the screen has gone, so the list behind shows it vanish. */
    const remove = () => {
        setAsking(null);
        router.back();
        toast(`Deleted “${expense.title}”`);
        setTimeout(() => deleteExpense(expense.id), 380);
    };

    return (
        <>
            <Screen tabBar={false}>
                <Header title="Expense" eyebrow={group ? `${group.emoji} ${group.name}` : undefined} />

                <GlassSurface kind="thick" style={{ paddingVertical: 22, paddingHorizontal: 18, gap: 8, alignItems: 'center' }}>
                    <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 32, lineHeight: 40 }}>{categoryEmoji(expense.category)}</Text>
                    </View>
                    <Text variant="title">{expense.title}</Text>
                    <Text variant="display" weight="semibold" tabular>
                        {rupees(expense.amount)}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {categoryLabel(expense.category)} · {payer} paid · {when(expense.createdAt)}
                    </Text>
                </GlassSurface>

                <GlassSurface style={{ flexDirection: 'row', paddingVertical: 16 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="caption" tone="secondary">
                            You paid
                        </Text>
                        <Text variant="heading" tabular numberOfLines={1} adjustsFontSizeToFit style={{ paddingHorizontal: 6 }}>
                            {rupees(paid)}
                        </Text>
                    </View>
                    <View style={{ width: 1, backgroundColor: tokens.border }} />
                    <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="caption" tone="secondary">
                            Your share
                        </Text>
                        <Text variant="heading" tabular numberOfLines={1} adjustsFontSizeToFit style={{ paddingHorizontal: 6 }}>
                            {rupees(share)}
                        </Text>
                    </View>
                    <View style={{ width: 1, backgroundColor: tokens.border }} />
                    <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="caption" tone="secondary">
                            {effect > 0 ? 'You lent' : effect < 0 ? 'You borrowed' : 'Your balance'}
                        </Text>
                        <Text variant="heading" tabular numberOfLines={1} adjustsFontSizeToFit style={{ paddingHorizontal: 6 }} tone={effect > 0 ? 'in' : effect < 0 ? 'out' : 'secondary'}>
                            {effect === 0 ? 'No change' : rupees(Math.abs(effect))}
                        </Text>
                    </View>
                </GlassSurface>

                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Split {howSplit(expense, group?.memberIds.length ?? 0)}
                </Text>
                <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                    {[...expense.splits].sort((a, b) => order(a.userId) - order(b.userId)).map((split, index) => {
                        const person = personOf(split.userId);
                        const weight = expense.weights?.[split.userId];
                        return (
                            <View key={split.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                                <Avatar name={person.name} size={36} />
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text variant="label" align="left">
                                        {split.userId === ME ? 'You' : person.first}
                                    </Text>
                                    {split.userId === expense.payerId || weight ? (
                                        <Text variant="caption" tone="secondary" align="left">
                                            {[split.userId === expense.payerId ? `paid ${rupees(expense.amount)}` : null, weight ? `${weight} ${weight === 1 ? 'share' : 'shares'}` : null].filter(Boolean).join(' · ')}
                                        </Text>
                                    ) : null}
                                </View>
                                <Text variant="label" tabular>
                                    {rupees(split.amount)}
                                </Text>
                            </View>
                        );
                    })}
                </GlassSurface>

                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Receipt
                </Text>
                {expense.receipt ? (
                    <GlassSurface style={{ padding: 10, gap: 10 }}>
                        {photoGone ? (
                            <View style={{ height: 120, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: tokens.chip }}>
                                <Text variant="label">This photo isn’t on your phone any more</Text>
                                <Text variant="caption" tone="secondary">
                                    Replace it, or remove it.
                                </Text>
                            </View>
                        ) : (
                            <View style={{ height: 260, borderRadius: 18, overflow: 'hidden' }}>
                                {photoReady ? null : (
                                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                                        <Skeleton height={260} radius={18} />
                                    </View>
                                )}
                                <Image source={{ uri: expense.receipt }} accessibilityLabel={`Receipt for ${expense.title}`} resizeMode="cover" onLoad={() => setPhotoReady(true)} onError={() => setPhotoGone(true)} style={{ width: '100%', height: '100%' }} />
                            </View>
                        )}
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <GlassButton kind="thin" style={{ flex: 1 }} contentStyle={{ height: 46 }} onPress={() => setAsking('receipt')}>
                                <Text variant="label">Replace</Text>
                            </GlassButton>
                            <GlassButton
                                kind="thin"
                                style={{ flex: 1 }}
                                contentStyle={{ height: 46 }}
                                onPress={() => {
                                    setReceipt(expense.id, null);
                                    toast('Receipt removed');
                                }}
                            >
                                <Text variant="label">Remove</Text>
                            </GlassButton>
                        </View>
                    </GlassSurface>
                ) : (
                    <GlassButton kind="thin" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} onPress={() => setAsking('receipt')}>
                        <Receipt size={19} color={tokens.fg} strokeWidth={2.2} />
                        <Text variant="label">Add a receipt</Text>
                    </GlassButton>
                )}

                <GlassButton kind="thin" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} onPress={() => setAsking('delete')}>
                    <Trash2 size={18} color={tokens.danger} strokeWidth={2.2} />
                    <Text variant="label" weight="bold" tone="danger">
                        Delete expense
                    </Text>
                </GlassButton>
            </Screen>

            <Sheet open={asking === 'receipt'} onClose={() => setAsking(null)} title="Add a receipt" hint="It stays on this phone until accounts arrive in Phase 3.">
                <GlassButton kind="reg" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} onPress={() => pick('camera')}>
                    <Camera size={19} color={tokens.fg} strokeWidth={2.2} />
                    <Text variant="label">Take a photo</Text>
                </GlassButton>
                <GlassButton kind="reg" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} onPress={() => pick('photos')}>
                    <ImageIcon size={19} color={tokens.fg} strokeWidth={2.2} />
                    <Text variant="label">Choose from photos</Text>
                </GlassButton>
            </Sheet>

            <Sheet open={asking === 'delete'} onClose={() => setAsking(null)} title={`Delete “${expense.title}”?`} hint="Everyone's balances go back to how they were before it. This can't be undone.">
                <GlassButton kind="reg" contentStyle={{ height: 54, flexDirection: 'row', gap: 10 }} onPress={remove}>
                    <Trash2 size={18} color={tokens.danger} strokeWidth={2.2} />
                    <Text variant="label" weight="bold" tone="danger">
                        Delete expense
                    </Text>
                </GlassButton>
                <GlassButton kind="accent" contentStyle={{ height: 54 }} onPress={() => setAsking(null)}>
                    <Text variant="heading" tone="onAccent">
                        Keep it
                    </Text>
                </GlassButton>
            </Sheet>
        </>
    );
}
