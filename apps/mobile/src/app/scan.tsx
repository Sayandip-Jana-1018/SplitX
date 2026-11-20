/**
 * Scanning a bill: a photo from the camera or from your photos, read by the server's AI (the
 * website's own scan, POST /api/v1/receipts/scan), and shown back for you to check: every item,
 * the taxes and charges, and the printed total. Adding it opens a new expense already filled in,
 * with the photo kept as its receipt; or splitting it item by item, by who had what (SplitByItems).
 *
 * The photo is shrunk on the phone first (scanPhoto.ts). The reading needs a connection and an
 * account; without either, the screen says so and offers adding by hand. The demo shows a sample
 * bill instead, read as the server would read it, so its results and splitting can be tried.
 */
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Camera, ImageIcon, ListChecks, RotateCcw, TriangleAlert } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';
import type { ReceiptScan } from '@/lib/contract/v1';
import { api, ApiError } from '~/api';
import { useAuth } from '~/auth/AuthProvider';
import { photoForScan } from '~/data/scanPhoto';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { categoryEmoji, knownCategory } from '~/ui/category';
import { EmptyState } from '~/ui/EmptyState';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { rupees } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { SplitByItems } from '~/ui/SplitByItems';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

type Stage =
    | { kind: 'choose' }
    | { kind: 'reading'; uri: string }
    | { kind: 'read'; uri: string; scan: ReceiptScan }
    | { kind: 'split'; uri: string; scan: ReceiptScan }
    | { kind: 'failed'; uri: string; message: string };

/** The demo's bill: the sample every Gemini model read right on 21 November. */
const SAMPLE: ReceiptScan = {
    merchant: 'Spice Route Kitchen',
    date: '2026-11-14',
    items: [
        { name: 'Paneer Tikka', quantity: 1, price: 32_000 },
        { name: 'Butter Naan', quantity: 4, price: 24_000 },
        { name: 'Dal Makhani', quantity: 1, price: 28_000 },
        { name: 'Chicken Biryani', quantity: 2, price: 70_000 },
        { name: 'Fresh Lime Soda', quantity: 3, price: 27_000 },
        { name: 'Gulab Jamun', quantity: 2, price: 22_000 },
    ],
    subtotal: 203_000,
    taxes: { 'Service Charge 5%': 10_150, 'CGST 2.5%': 5_075, 'SGST 2.5%': 5_075 },
    total: 223_300,
    currency: 'INR',
    category: 'food',
    confidence: 0.99,
    notes: null,
};

/** After this long, the reading says it is taking a careful second look. */
const SLOW_MS = 9_000;

export default function Scan() {
    const auth = useAuth();
    const toast = useToast();
    const [stage, setStage] = useState<Stage>({ kind: 'choose' });
    const [slow, setSlow] = useState(false);
    // A scan whose screen has gone, or that a newer one replaced, is let go.
    const current = useRef(0);

    useEffect(() => {
        if (stage.kind !== 'reading') return;
        const timer = setTimeout(() => setSlow(true), SLOW_MS);
        return () => {
            clearTimeout(timer);
            setSlow(false);
        };
    }, [stage]);
    useEffect(
        () => () => {
            current.current += 1;
        },
        [],
    );

    if (auth.status !== 'signed_in' && stage.kind === 'choose') {
        return (
            <Screen tabBar={false}>
                <Header title="Scan a bill" close />
                <EmptyState
                    emoji="🧾"
                    title="Scanning needs an account"
                    hint="Sign in, and SplitIT reads your bills for you: every item, the taxes and the total."
                    action={
                        <GlassButton kind="thin" contentStyle={{ height: 46, paddingHorizontal: 22 }} onPress={() => setStage({ kind: 'read', uri: '', scan: SAMPLE })}>
                            <Text variant="label" weight="bold">
                                Try a sample bill
                            </Text>
                        </GlassButton>
                    }
                />
            </Screen>
        );
    }

    const pick = async (from: 'camera' | 'photos') => {
        if (from === 'camera') {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
                toast('Camera access is off. You can turn it on in Settings.', 'info');
                return;
            }
        }
        const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
        const result = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
        const asset = result.canceled ? null : result.assets[0];
        if (!asset) return;

        const scan = ++current.current;
        setStage({ kind: 'reading', uri: asset.uri });
        try {
            const image = await photoForScan(asset.uri, asset.width, asset.height);
            const read = await api.scanReceipt(image);
            if (scan === current.current) setStage({ kind: 'read', uri: asset.uri, scan: read });
        } catch (error) {
            if (scan !== current.current) return;
            const message =
                error instanceof ApiError
                    ? error.kind === 'offline'
                        ? 'Scanning needs a connection. Add it by hand, or scan again when you’re back online.'
                        : error.message
                    : 'That photo couldn’t be read. Try another.';
            setStage({ kind: 'failed', uri: asset.uri, message });
        }
    };

    const addIt = (uri: string, scan: ReceiptScan) => {
        router.replace({
            pathname: '/add',
            params: { amount: String(scan.total), title: scan.merchant ?? '', category: knownCategory(scan.category), ...(uri ? { receipt: uri } : {}) },
        });
    };

    return (
        <Screen tabBar={false}>
            <Header title={stage.kind === 'split' ? 'Split by item' : 'Scan a bill'} eyebrow={stage.kind === 'split' ? (stage.scan.merchant ?? undefined) : undefined} close />
            {stage.kind === 'choose' ? <Choose onPick={pick} /> : null}
            {stage.kind === 'reading' ? <Reading uri={stage.uri} slow={slow} /> : null}
            {stage.kind === 'read' ? (
                <Result uri={stage.uri} scan={stage.scan} onAdd={() => addIt(stage.uri, stage.scan)} onSplit={() => setStage({ kind: 'split', uri: stage.uri, scan: stage.scan })} onAgain={() => setStage({ kind: 'choose' })} />
            ) : null}
            {stage.kind === 'split' ? <SplitByItems scan={stage.scan} receipt={stage.uri} /> : null}
            {stage.kind === 'failed' ? <Failed uri={stage.uri} message={stage.message} onAgain={() => setStage({ kind: 'choose' })} /> : null}
        </Screen>
    );
}

function Choose({ onPick }: { onPick: (from: 'camera' | 'photos') => void }) {
    const { tokens } = useLook();
    return (
        <>
            <GlassSurface kind="thick" style={{ paddingVertical: 26, paddingHorizontal: 22, gap: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 44, lineHeight: 52 }}>🧾</Text>
                <Text variant="heading">Photograph the whole bill</Text>
                <Text variant="label" tone="secondary">
                    Flat, in good light, with the total in the photo. SplitIT reads every item, the taxes and the total.
                </Text>
            </GlassSurface>
            <GlassButton kind="accent" contentStyle={{ height: 56, flexDirection: 'row', gap: 10 }} accessibilityLabel="Take a photo of the bill" onPress={() => onPick('camera')}>
                <Camera size={20} color={tokens.onAccent} strokeWidth={2.4} />
                <Text variant="heading" tone="onAccent">
                    Take a photo
                </Text>
            </GlassButton>
            <GlassButton kind="thin" contentStyle={{ height: 52, flexDirection: 'row', gap: 10 }} accessibilityLabel="Choose a photo of the bill" onPress={() => onPick('photos')}>
                <ImageIcon size={19} color={tokens.fg} strokeWidth={2.2} />
                <Text variant="label" weight="bold">
                    Choose from your photos
                </Text>
            </GlassButton>
        </>
    );
}

function Photo({ uri, dim }: { uri: string; dim?: boolean }) {
    // The demo's sample bill has no photo.
    if (!uri) return null;
    return (
        <GlassSurface style={{ padding: 8, alignItems: 'center' }}>
            <Image source={{ uri }} resizeMode="contain" accessibilityIgnoresInvertColors style={{ width: '100%', height: 220, borderRadius: 16, opacity: dim ? 0.55 : 1 }} />
        </GlassSurface>
    );
}

function Reading({ uri, slow }: { uri: string; slow: boolean }) {
    const { tokens } = useLook();
    return (
        <>
            <Photo uri={uri} dim />
            <View style={{ alignItems: 'center', gap: 10 }} accessibilityLiveRegion="polite">
                <ActivityIndicator color={tokens.accentText} size="large" />
                <Text variant="heading" onLiquid>
                    Reading your bill…
                </Text>
                <Text variant="caption" tone="secondary" onLiquid>
                    {slow ? 'Taking a careful second look. This can take up to a minute.' : 'Every item, the taxes and the total.'}
                </Text>
            </View>
        </>
    );
}

function Row({ name, amount, tone, strong }: { name: string; amount: number; tone?: 'secondary'; strong?: boolean }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 7 }}>
            <Text variant={strong ? 'heading' : 'label'} tone={tone ?? 'primary'} align="left" style={{ flex: 1 }}>
                {name}
            </Text>
            <Text variant={strong ? 'heading' : 'label'} tone={tone ?? 'primary'} tabular align="right">
                {rupees(amount)}
            </Text>
        </View>
    );
}

function Warning({ children }: { children: string }) {
    const { tokens } = useLook();
    return (
        <GlassSurface kind="thin" style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14 }}>
            <TriangleAlert size={18} color={tokens.accentText} strokeWidth={2.2} />
            <Text variant="caption" tone="secondary" align="left" style={{ flex: 1 }}>
                {children}
            </Text>
        </GlassSurface>
    );
}

function Result({ uri, scan, onAdd, onSplit, onAgain }: { uri: string; scan: ReceiptScan; onAdd: () => void; onSplit: () => void; onAgain: () => void }) {
    const { tokens } = useLook();
    const taxes = Object.entries(scan.taxes);
    const when = scan.date ? new Date(`${scan.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    return (
        <>
            <GlassSurface kind="thick" style={{ paddingVertical: 22, paddingHorizontal: 18, gap: 6, alignItems: 'center' }}>
                <Text style={{ fontSize: 34, lineHeight: 42 }}>{categoryEmoji(knownCategory(scan.category))}</Text>
                <Text variant="title" numberOfLines={2}>
                    {scan.merchant ?? 'Your bill'}
                </Text>
                {when ? (
                    <Text variant="caption" tone="secondary">
                        {when}
                    </Text>
                ) : null}
                <Text variant="display" tabular>
                    {rupees(scan.total)}
                </Text>
                <Text variant="caption" tone="secondary">
                    Printed total
                </Text>
            </GlassSurface>

            {scan.currency !== 'INR' ? <Warning>{`This bill is in ${scan.currency}. SplitIT records rupees, so change the amount to rupees before you save.`}</Warning> : null}
            {scan.confidence < 0.5 ? <Warning>The photo was hard to read. Check the amounts against the bill before you add it.</Warning> : null}
            {scan.notes ? <Warning>{scan.notes}</Warning> : null}

            {scan.items.length > 0 ? (
                <GlassSurface style={{ paddingHorizontal: 18, paddingVertical: 10 }}>
                    {scan.items.map((item, index) => (
                        <Row key={`${index}-${item.name}`} name={item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name} amount={item.price} />
                    ))}
                    {taxes.length > 0 ? <View style={{ height: 1, backgroundColor: tokens.border, marginVertical: 6 }} /> : null}
                    {taxes.map(([name, amount]) => (
                        <Row key={name} name={name} amount={amount} tone="secondary" />
                    ))}
                    <View style={{ height: 1, backgroundColor: tokens.border, marginVertical: 6 }} />
                    <Row name="Total" amount={scan.total} strong />
                </GlassSurface>
            ) : null}

            <Photo uri={uri} />

            <GlassButton kind="accent" contentStyle={{ height: 56 }} accessibilityLabel={`Add ${rupees(scan.total)} as an expense`} onPress={onAdd}>
                <Text variant="heading" tone="onAccent">
                    {`Add ${rupees(scan.total)} as an expense`}
                </Text>
            </GlassButton>
            {scan.items.length > 1 ? (
                <GlassButton kind="thin" contentStyle={{ height: 52, flexDirection: 'row', gap: 8 }} accessibilityLabel="Split the bill item by item" onPress={onSplit}>
                    <ListChecks size={18} color={tokens.fg} strokeWidth={2.2} />
                    <Text variant="label" weight="bold">
                        Split item by item
                    </Text>
                </GlassButton>
            ) : null}
            <GlassButton kind="thin" contentStyle={{ height: 48, flexDirection: 'row', gap: 8 }} onPress={onAgain}>
                <RotateCcw size={17} color={tokens.fg} strokeWidth={2.2} />
                <Text variant="label" weight="bold">
                    Scan another
                </Text>
            </GlassButton>
        </>
    );
}

function Failed({ uri, message, onAgain }: { uri: string; message: string; onAgain: () => void }) {
    const { tokens } = useLook();
    return (
        <>
            <Photo uri={uri} dim />
            <Warning>{message}</Warning>
            <GlassButton kind="accent" contentStyle={{ height: 52, flexDirection: 'row', gap: 8 }} onPress={onAgain}>
                <RotateCcw size={18} color={tokens.onAccent} strokeWidth={2.4} />
                <Text variant="heading" tone="onAccent">
                    Try another photo
                </Text>
            </GlassButton>
            <GlassButton kind="thin" contentStyle={{ height: 48 }} onPress={() => router.replace('/add')}>
                <Text variant="label" weight="bold">
                    Add it by hand
                </Text>
            </GlassButton>
        </>
    );
}
