/**
 * The settle-up map: everyone in a group, and an arrow for each payment that clears it, with its
 * amount. Laid out by the website's own code (src/lib/settleMap.ts), so both draw the same map.
 *
 * Tap someone to see only their payments, spelled out underneath; tap them again for everyone.
 * While the screen shows, a dash runs along each arrow, the way the money goes; Calm keeps it still,
 * and it stops while the screen is hidden.
 */
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';
import { clamp, restingLayout, spreadLabels } from '@shared/settleMap';
import { useLook } from '~/theme/ThemeProvider';
import { Avatar } from './Avatar';
import { rupees } from './money';
import { Text } from './Text';

export interface MapPerson {
    id: string;
    name: string;
}

export interface MapPayment {
    from: string;
    to: string;
    amount: number;
}

const AVATAR = 52;
/** Room around the map for a person's circle and the name under it. */
const MARGINS = { top: 34, right: 48, bottom: 54, left: 48 };
const LABEL_HEIGHT = 24;

/** "₹600", or "₹120.50" when there are paise: the map has little room. */
const amountOf = (paise: number) => rupees(paise).replace(/\.00$/, '');
/** About how wide an amount's label is drawn (bold caption figures, and its padding). */
const labelWidth = (text: string) => 20 + text.length * 7.6;
/** The dash pattern's length: the flow moves by exactly one, so it loops without a jump. */
const DASH = 18;

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** One payment's arrow, as the layout gives it. */
type EdgeLayout = ReturnType<typeof restingLayout>['arrows'][number];

const firstName = (name: string) => name.split(' ')[0];

/** "Kabir pays you ₹600", "You pay Ravi ₹250": the screen calls the person using the app "You". */
const sentence = (from: string, to: string, paise: number) => (from === 'You' ? `You pay ${to} ${amountOf(paise)}` : `${from} pays ${to === 'You' ? 'you' : to} ${amountOf(paise)}`);

/**
 * Where a line from a person's centre towards (tx, ty) leaves the block their circle and name
 * take up, a little past it: arrows start and end there, never on a name.
 */
function edgeOf(x: number, y: number, tx: number, ty: number): [number, number] {
    const dx = tx - x;
    const dy = ty - y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const across = Math.abs(ux) < 1e-6 ? Infinity : 32 / Math.abs(ux);
    const down = Math.abs(uy) < 1e-6 ? Infinity : (uy > 0 ? 50 : 30) / Math.abs(uy);
    const d = Math.min(across, down) + 4;
    return [x + ux * d, y + uy * d];
}

/** The arrow's curve, and its head: a small triangle along the curve's last direction. */
function shapeOf(arrow: EdgeLayout) {
    const curve = `M${arrow.sx},${arrow.sy} Q${arrow.cpx},${arrow.cpy} ${arrow.ex},${arrow.ey}`;
    const dx = arrow.ex - arrow.cpx;
    const dy = arrow.ey - arrow.cpy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const tipX = arrow.ex + ux * 6;
    const tipY = arrow.ey + uy * 6;
    const baseX = arrow.ex - ux * 4;
    const baseY = arrow.ey - uy * 4;
    const head = `M${tipX},${tipY} L${baseX - uy * 5},${baseY + ux * 5} L${baseX + uy * 5},${baseY - ux * 5} Z`;
    return { curve, head };
}

function Flow({ d, color, offset }: { d: string; color: string; offset: SharedValue<number> }) {
    const props = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
    return <AnimatedPath d={d} stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeDasharray={`3 ${DASH - 3}`} fill="none" animatedProps={props} />;
}

export function SettleMap({ people, payments }: { people: MapPerson[]; payments: MapPayment[] }) {
    const { tokens, calm } = useLook();
    const focused = useIsFocused();
    const [width, setWidth] = useState(0);
    const [focus, setFocus] = useState<string | null>(null);
    const height = clamp(width * 0.84, 300, 380);
    const ids = useMemo(() => people.map((person) => person.id), [people]);
    const nameOf = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);

    const layout = useMemo(() => {
        if (width <= 0) return null;
        const rest = restingLayout(ids, payments, width, height, false, MARGINS);
        const at = new Map(rest.nodes.map((node) => [node.name, node]));
        for (const arrow of rest.arrows) {
            const from = at.get(arrow.settlement.from);
            const to = at.get(arrow.settlement.to);
            if (!from || !to) continue;
            [arrow.sx, arrow.sy] = edgeOf(from.x, from.y, arrow.cpx, arrow.cpy);
            [arrow.ex, arrow.ey] = edgeOf(to.x, to.y, arrow.cpx, arrow.cpy);
        }
        // Each amount sits by its arrow, moved off any other amount and off the people.
        const texts = rest.arrows.map((arrow) => amountOf(arrow.settlement.amount));
        const spots = spreadLabels(
            rest.arrows.map((arrow, i) => ({ x: arrow.pillX, y: arrow.pillY, width: labelWidth(texts[i]), height: LABEL_HEIGHT })),
            rest.nodes.map((node) => ({ x: node.x, y: node.y + 10, width: 64, height: AVATAR + 26 })),
            { width, height },
        );
        return { ...rest, labels: rest.arrows.map((arrow, i) => ({ arrow, text: texts[i], width: labelWidth(texts[i]), ...spots[i] })) };
    }, [ids, payments, width, height]);

    // The flow: one value for every arrow, running only while it can be seen.
    const offset = useSharedValue(0);
    const flowing = focused && !calm;
    useEffect(() => {
        if (!flowing) {
            cancelAnimation(offset);
            return;
        }
        offset.set(0);
        offset.set(withRepeat(withTiming(-DASH, { duration: 900, easing: Easing.linear }), -1, false));
        return () => cancelAnimation(offset);
    }, [flowing, offset]);

    // Someone tapped who has since left the map: show everyone again.
    const shown = focus && ids.includes(focus) ? focus : null;
    const involves = (payment: MapPayment) => !shown || payment.from === shown || payment.to === shown;
    const theirs = shown ? payments.filter(involves) : [];

    const measured = (event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.width);
        setWidth((current) => (current === next ? current : next));
    };

    return (
        <View style={{ gap: 12 }}>
            <View onLayout={measured} style={{ height, width: '100%' }}>
                {layout ? (
                    <>
                        <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
                            {layout.arrows.map((arrow, index) => {
                                const { curve, head } = shapeOf(arrow);
                                const dim = involves(arrow.settlement) ? 1 : 0.18;
                                return (
                                    <G key={index} opacity={dim}>
                                        <Path d={curve} stroke={tokens.accentText} strokeOpacity={0.28} strokeWidth={6} strokeLinecap="round" fill="none" />
                                        <Path d={curve} stroke={tokens.accentText} strokeOpacity={0.75} strokeWidth={2} strokeLinecap="round" fill="none" />
                                        {flowing ? <Flow d={curve} color={tokens.onAccent} offset={offset} /> : null}
                                        <Path d={head} fill={tokens.accentText} />
                                    </G>
                                );
                            })}
                        </Svg>

                        {layout.labels.map((label, index) => (
                            <View
                                key={`amount-${index}`}
                                pointerEvents="none"
                                style={{
                                    position: 'absolute',
                                    left: label.x - label.width / 2,
                                    top: label.y - LABEL_HEIGHT / 2,
                                    width: label.width,
                                    height: LABEL_HEIGHT,
                                    borderRadius: LABEL_HEIGHT / 2,
                                    backgroundColor: tokens.accent,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: involves(label.arrow.settlement) ? 1 : 0.25,
                                }}
                            >
                                <Text variant="caption" weight="bold" tone="onAccent" tabular numberOfLines={1}>
                                    {label.text}
                                </Text>
                            </View>
                        ))}

                        {layout.nodes.map((node) => {
                            const name = nameOf.get(node.name) ?? '';
                            const isFocus = shown === node.name;
                            const quiet = shown !== null && !isFocus && !payments.some((p) => involves(p) && (p.from === node.name || p.to === node.name));
                            return (
                                <Pressable
                                    key={node.name}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${name}: show only their payments`}
                                    accessibilityState={{ selected: isFocus }}
                                    hitSlop={6}
                                    onPress={() => setFocus(isFocus ? null : node.name)}
                                    style={{ position: 'absolute', left: node.x - 44, top: node.y - AVATAR / 2, width: 88, alignItems: 'center', gap: 4, opacity: quiet ? 0.35 : 1 }}
                                >
                                    <Avatar name={name} size={AVATAR} ring={isFocus} />
                                    <Text variant="caption" weight="semibold" numberOfLines={1}>
                                        {firstName(name)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </>
                ) : null}
            </View>

            {/* What the map says, in words: everyone's payments, or the tapped person's. */}
            <View style={{ gap: 4, minHeight: 20 }}>
                {shown ? (
                    theirs.map((payment, index) => (
                        <Text key={index} variant="caption" tone="secondary" tabular>
                            {sentence(firstName(nameOf.get(payment.from) ?? ''), firstName(nameOf.get(payment.to) ?? ''), payment.amount)}
                        </Text>
                    ))
                ) : (
                    <Text variant="caption" tone="secondary">
                        {payments.length === 1 ? 'One payment clears this group.' : `${payments.length} payments clear this group.`} Tap someone for theirs.
                    </Text>
                )}
            </View>
        </View>
    );
}
