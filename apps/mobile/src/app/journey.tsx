/**
 * Balance Journey: how your balance got to where it is, one expense or payment at a time. The
 * line draws itself in; tap anywhere on it to see which expense moved it and by how much. Across
 * every group, or one group with ?group=.
 */
import { Canvas, Circle, DashPathEffect, Group, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { activity, type ActivityItem } from '~/data/ledger';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { categoryEmoji } from '~/ui/category';
import { EmptyState } from '~/ui/EmptyState';
import { tap } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { rupees } from '~/ui/money';
import { RollingAmount } from '~/ui/RollingAmount';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { when } from '~/ui/time';

interface Step extends ActivityItem {
    /** What it did to your balance: an expense you paid for raises it, a payment you received lowers it. */
    delta: number;
    /** Your balance just after it. */
    after: number;
}

const CHART_H = 210;
const PAD_X = 14;
const PAD_Y = 18;

/** 'rgb(1, 2, 3)' at an alpha, for the fill under the line. */
const fade = (color: string, alpha: number) => (color.startsWith('rgb(') ? color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`) : color);

export default function Journey() {
    const params = useLocalSearchParams<{ group?: string }>();
    const { tokens, calm } = useLook();
    const { ledger } = useLedger();
    const group = ledger.groups.find((candidate) => candidate.id === params.group);
    const [width, setWidth] = useState(0);

    const steps = useMemo(
        () =>
            activity(ledger, group?.id)
                .slice()
                .reverse()
                .reduce<Step[]>((list, item) => {
                    const delta = item.kind === 'expense' ? item.yours : -item.yours;
                    if (delta !== 0) list.push({ ...item, delta, after: (list.at(-1)?.after ?? 0) + delta });
                    return list;
                }, []),
        [ledger, group],
    );
    const now = steps.at(-1)?.after ?? 0;
    const [selected, setSelected] = useState<number | null>(null);
    const chosen = selected === null ? steps.length : Math.min(selected, steps.length);

    // The points: where it started (nothing), then the balance after each step.
    const chart = useMemo(() => {
        const values = [0, ...steps.map((step) => step.after)];
        let low = Math.min(0, ...values);
        let high = Math.max(0, ...values);
        if (high === low) high = low + 1;
        const span = high - low;
        low -= span * 0.08;
        high += span * 0.08;
        const inner = Math.max(1, width - PAD_X * 2);
        const x = (index: number) => PAD_X + (values.length === 1 ? inner / 2 : (index * inner) / (values.length - 1));
        const y = (value: number) => PAD_Y + ((high - value) / (high - low)) * (CHART_H - PAD_Y * 2);
        const points = values.map((value, index) => ({ x: x(index), y: y(value) }));

        // The same smooth curve, twice: once as the line, once closed down to the bottom as the fill.
        const curve = (builder: ReturnType<typeof Skia.PathBuilder.Make>) => {
            points.forEach((point, index) => {
                if (index === 0) {
                    builder.moveTo(point.x, point.y);
                    return;
                }
                const before = points[index - 1];
                const middle = (before.x + point.x) / 2;
                builder.cubicTo(middle, before.y, middle, point.y, point.x, point.y);
            });
            return builder;
        };
        const line = curve(Skia.PathBuilder.Make()).detach();
        const area = curve(Skia.PathBuilder.Make()).lineTo(points.at(-1)!.x, CHART_H).lineTo(points[0].x, CHART_H).close().detach();
        const zero = Skia.PathBuilder.Make().moveTo(PAD_X, y(0)).lineTo(width - PAD_X, y(0)).detach();
        return { points, line, area, zero };
    }, [steps, width]);

    const progress = useSharedValue(calm ? 1 : 0);
    useEffect(() => {
        if (width === 0) return;
        progress.set(0);
        progress.set(calm ? 1 : withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }));
    }, [calm, progress, width, steps.length]);
    const fill = useDerivedValue(() => progress.value);

    const choose = (x: number) => {
        if (chart.points.length < 2) return;
        const gap = chart.points[1].x - chart.points[0].x;
        const index = Math.max(0, Math.min(chart.points.length - 1, Math.round((x - PAD_X) / gap)));
        tap();
        setSelected(index);
    };

    const step = chosen > 0 ? steps[chosen - 1] : null;
    const point = chart.points[chosen];
    const groupName = (id: string) => ledger.groups.find((candidate) => candidate.id === id)?.name ?? '';

    return (
        <Screen tabBar={false}>
            <Header title="Balance Journey" eyebrow={group ? `${group.emoji} ${group.name}` : 'All your groups'} />

            <View style={{ alignItems: 'center', gap: 2 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    {now === 0 ? 'All square now' : now > 0 ? 'You are owed now' : 'You owe now'}
                </Text>
                <RollingAmount paise={now} sign variant="display" weight="semibold" onLiquid />
            </View>

            {steps.length === 0 ? (
                <EmptyState emoji="🧭" title="Your journey starts here" hint="Add an expense or a payment, and every one of them moves this line." />
            ) : (
                <>
                    <GlassSurface style={{ paddingTop: 14, paddingBottom: 8, paddingHorizontal: 6, gap: 6 }}>
                        <View style={{ minHeight: 40, paddingHorizontal: 10, gap: 2 }} accessibilityLiveRegion="polite">
                            <Text variant="label" numberOfLines={1}>
                                {step ? `${categoryEmoji(step.category)} ${step.title}` : 'Where it started'}
                            </Text>
                            <Text variant="caption" tone="secondary" tabular>
                                {step ? `${rupees(step.delta, { sign: true })} → ${rupees(step.after, { sign: true })} · ${when(step.at)}` : 'Nothing owed either way'}
                            </Text>
                        </View>
                        <View
                            style={{ height: CHART_H }}
                            onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
                            onTouchEnd={(event) => choose(event.nativeEvent.locationX)}
                            accessible
                            accessibilityRole="adjustable"
                            accessibilityLabel="Your balance over time"
                            accessibilityValue={{ text: step ? `${step.title}, ${rupees(step.after, { sign: true })}` : 'Start' }}
                            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                            onAccessibilityAction={(event) => setSelected(Math.max(0, Math.min(steps.length, chosen + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))}
                        >
                            {width > 0 ? (
                                <Canvas style={{ width, height: CHART_H }}>
                                    <Path path={chart.zero} style="stroke" strokeWidth={1} color={tokens.borderStrong}>
                                        <DashPathEffect intervals={[4, 6]} />
                                    </Path>
                                    <Group opacity={fill}>
                                        <Path path={chart.area}>
                                            <LinearGradient start={vec(0, 0)} end={vec(0, CHART_H)} colors={[fade(tokens.accentText, 0.38), fade(tokens.accentText, 0)]} />
                                        </Path>
                                    </Group>
                                    <Path path={chart.line} style="stroke" strokeWidth={3} strokeCap="round" strokeJoin="round" color={tokens.accentText} start={0} end={progress} />
                                    <Group opacity={fill}>
                                        {chart.points.map((dot, index) => (
                                            <Circle key={index} cx={dot.x} cy={dot.y} r={3} color={tokens.fg} opacity={0.75} />
                                        ))}
                                        {point ? (
                                            <>
                                                <Circle cx={point.x} cy={point.y} r={13} color={fade(tokens.accentText, 0.25)} />
                                                <Circle cx={point.x} cy={point.y} r={6.5} color={tokens.accentText} />
                                                <Circle cx={point.x} cy={point.y} r={2.5} color={tokens.fg} />
                                            </>
                                        ) : null}
                                    </Group>
                                </Canvas>
                            ) : null}
                        </View>
                    </GlassSurface>

                    <Text variant="eyebrow" tone="secondary" onLiquid>
                        Every step, newest first
                    </Text>
                    <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                        {steps
                            .slice()
                            .reverse()
                            .map((entry, index) => (
                                <View key={entry.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}>
                                    <Text style={{ fontSize: 20, lineHeight: 26 }}>{categoryEmoji(entry.category)}</Text>
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <Text variant="label" align="left" numberOfLines={1}>
                                            {entry.title}
                                        </Text>
                                        <Text variant="caption" tone="secondary" align="left" numberOfLines={1}>
                                            {group ? when(entry.at) : `${groupName(entry.groupId)} · ${when(entry.at)}`}
                                        </Text>
                                    </View>
                                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                                        <Text variant="label" tabular tone={entry.delta > 0 ? 'in' : 'out'}>
                                            {rupees(entry.delta, { sign: true })}
                                        </Text>
                                        <Text variant="caption" tone="muted" tabular>
                                            then {rupees(entry.after, { sign: true })}
                                        </Text>
                                    </View>
                                </View>
                            ))}
                    </GlassSurface>
                </>
            )}
        </Screen>
    );
}
