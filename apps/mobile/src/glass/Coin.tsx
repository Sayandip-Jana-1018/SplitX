/**
 * A coin of glass and theme-coloured metal: the website's coin shader, turning by the same rules
 * (src/lib/glass/coins.ts). Whatever is put inside it sits on its face. Inside a glass layer the
 * layer draws it; outside one it draws its own canvas.
 */
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import { useEffect, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { coinCode, coinPose, coinReach, type CoinKind } from '@shared/glass/coins';
import { useLook } from '~/theme/ThemeProvider';
import { webDeps } from './deps';
import { effects } from './effects';
import { useGlass } from './GlassProvider';
import { nextOrder, useLayer } from './layer';
import { useScreenOrigin, useScreenPlace } from './origin';

interface Props {
    kind: CoinKind;
    /** The coin's diameter. */
    size: number;
    /** Keeps two coins out of step. */
    seed?: number;
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
}

export function Coin(props: Props) {
    return useLayer() ? <LayeredCoin {...props} /> : <StandaloneCoin {...props} />;
}

/** Room for a slice at its furthest, a tall bill, and the shadow. */
const reachOf = (kind: CoinKind, radius: number) => radius * (coinReach(kind) + 0.24) + 14;

function LayeredCoin({ kind, size, seed = 0, style, children }: Props) {
    const layer = useLayer()!;
    const { pal, calm } = useLook();
    const { ref, measure, place } = useScreenPlace();
    const [order] = useState(nextOrder);
    const opacity = useSharedValue(calm ? 1 : 0);
    const radius = size / 2;

    useEffect(() => {
        opacity.set(calm ? 1 : withTiming(1, { duration: 420 }));
    }, [calm, opacity]);

    useEffect(
        () => layer.add({ kind: 'coin', order, place, measure, opacity, coin: kind, code: coinCode(kind), seed, radius, reach: reachOf(kind, radius), light: pal.light, rim: pal.rim }),
        [layer, order, place, measure, opacity, kind, seed, radius, pal],
    );

    return (
        <View ref={ref} onLayout={measure} style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
            {children}
        </View>
    );
}

function StandaloneCoin({ kind, size, seed = 0, style, children }: Props) {
    const { pal } = useLook();
    const { time, liquid } = useGlass();
    const { ref, measure, origin } = useScreenOrigin();
    const radius = size / 2;
    const reach = reachOf(kind, radius);
    const code = coinCode(kind);

    const uniforms = useDerivedValue(() => {
        const t = time.value;
        const [x, y] = origin.value;
        const pose = coinPose(kind, seed, t);
        const cx = x + radius;
        const cy = y + radius;
        return {
            ...liquid.value,
            uOrigin: [cx - reach, cy - reach],
            uC: [cx, cy, radius, pose.spin],
            uTilt: [pose.axisX, pose.axisY, pose.lean, pose.facing],
            uKind: code,
            uCut: pose.cut,
            uCutAt: pose.cutAt,
            uFade: 1,
            uDetail: 1,
            uLight: pal.light,
            uRimC: pal.rim,
        };
    }, webDeps([pal, kind, seed, radius, reach, code]));

    return (
        <View ref={ref} onLayout={measure} style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center', zIndex: 0 }, style]}>
            <Canvas
                style={{
                    position: 'absolute',
                    left: radius - reach,
                    top: radius - reach,
                    width: reach * 2,
                    height: reach * 2,
                    pointerEvents: 'none',
                    zIndex: -1,
                }}
            >
                <Fill>
                    <Shader source={effects().coin} uniforms={uniforms} />
                </Fill>
            </Canvas>
            {children}
        </View>
    );
}
