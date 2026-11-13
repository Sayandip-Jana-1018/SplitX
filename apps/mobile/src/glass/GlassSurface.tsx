/**
 * A piece of glass: it bends the liquid behind it at its edges, frosts it by the person's choice
 * of glass, catches the light on its rim, and casts a soft shadow. Words and controls sit on top
 * as ordinary views.
 */
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import { useMemo, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { surfaceLook, type GlassKind, type GlassStyleId } from '@shared/glass/styles';
import { useLook } from '~/theme/ThemeProvider';
import { webDeps } from './deps';
import { effects } from './effects';
import { useGlass } from './GlassProvider';
import { useScreenOrigin } from './origin';

/** Room around the glass for its shadow. */
const MARGIN = 26;

export interface GlassSurfaceProps extends ViewProps {
    kind?: GlassKind;
    radius?: number;
    /** Shows one kind of glass whatever the person chose: for the samples in Appearance. */
    glassStyle?: GlassStyleId;
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
}

export function GlassSurface({ kind = 'reg', radius = 24, glassStyle, style, children, onLayout, ...rest }: GlassSurfaceProps) {
    const { pal, glassStyle: chosen } = useLook();
    const { liquid } = useGlass();
    const { ref, measure, origin } = useScreenOrigin();
    const [size, setSize] = useState({ w: 0, h: 0 });
    const look = useMemo(() => surfaceLook(kind, glassStyle ?? chosen), [kind, glassStyle, chosen]);
    const r = Math.min(radius, size.w / 2, size.h / 2);

    const uniforms = useDerivedValue(() => {
        const [x, y] = origin.value;
        return {
            ...liquid.value,
            uOrigin: [x - MARGIN, y - MARGIN],
            uInset: [MARGIN, MARGIN],
            uSize: [size.w, size.h],
            uRadius: r,
            uFrost: look.frost,
            uTint: look.tint,
            uTintK: pal.tintK,
            uTintC: look.colored ? pal.tinted : pal.tint,
            uAcc: pal.acc,
            uRefract: look.refract,
            uRim: look.rim,
            uWobble: look.wobble,
            uLight: pal.light,
            uRimC: pal.rim,
            uShadow: pal.shadow,
        };
    }, webDeps([pal, size, r, look]));

    const laidOut = (event: LayoutChangeEvent) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        setSize((current) => (current.w === w && current.h === h ? current : { w, h }));
        measure();
        onLayout?.(event);
    };

    return (
        // zIndex keeps the canvas under the content everywhere, including in a browser, where an
        // absolutely placed canvas would otherwise paint over icons.
        <View ref={ref} onLayout={laidOut} style={[{ borderRadius: r, zIndex: 0 }, style]} {...rest}>
            {size.w > 0 && (
                <Canvas
                    style={{
                        position: 'absolute',
                        left: -MARGIN,
                        top: -MARGIN,
                        width: size.w + MARGIN * 2,
                        height: size.h + MARGIN * 2,
                        pointerEvents: 'none',
                        zIndex: -1,
                    }}
                >
                    <Fill>
                        <Shader source={effects().surface} uniforms={uniforms} />
                    </Fill>
                </Canvas>
            )}
            {children}
        </View>
    );
}
