/**
 * A coin of glass and theme-coloured metal: the website's coin shader, turning by the same rules
 * (src/lib/glass/coins.ts). Whatever is put inside it sits on its face.
 */
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { coinCode, coinPose, coinReach, type CoinKind } from '@shared/glass/coins';
import { useLook } from '~/theme/ThemeProvider';
import { webDeps } from './deps';
import { effects } from './effects';
import { useGlass } from './GlassProvider';
import { useScreenOrigin } from './origin';

interface Props {
    kind: CoinKind;
    /** The coin's diameter. */
    size: number;
    /** Keeps two coins out of step. */
    seed?: number;
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
}

export function Coin({ kind, size, seed = 0, style, children }: Props) {
    const { pal } = useLook();
    const { time, liquid } = useGlass();
    const { ref, measure, origin } = useScreenOrigin();
    const radius = size / 2;
    // Room for a slice at its furthest, a tall bill, and the shadow.
    const reach = radius * (coinReach(kind) + 0.24) + 14;
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
