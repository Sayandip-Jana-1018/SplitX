/**
 * A piece of glass: it bends the liquid behind it at its edges, frosts it by the person's choice
 * of glass, catches the light on its rim, and casts a soft shadow. Words and controls sit on top
 * as ordinary views.
 *
 * Inside a glass layer (layer.tsx) it only reports where it is and how it looks, and the layer
 * draws it with the rest in one canvas. Outside one it draws its own canvas, as it always did.
 */
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { surfaceLook, type GlassKind, type GlassStyleId } from '@shared/glass/styles';
import { useLook } from '~/theme/ThemeProvider';
import { webDeps } from './deps';
import { effects } from './effects';
import { useGlass } from './GlassProvider';
import { MARGIN, nextOrder, useLayer, type SurfaceLook } from './layer';
import { useScreenOrigin, useScreenPlace } from './origin';

export interface GlassSurfaceProps extends ViewProps {
    kind?: GlassKind;
    radius?: number;
    /** Shows one kind of glass whatever the person chose: for the samples in Appearance. */
    glassStyle?: GlassStyleId;
    /** A button's press, so the glass gives with the content. */
    scale?: SharedValue<number>;
    /** A disabled control's glass is dimmed with its content. */
    dimmed?: boolean;
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
}

/** The uniforms that change only with the look. */
function useSurfaceLook(kind: GlassKind, glassStyle?: GlassStyleId): SurfaceLook {
    const { pal, glassStyle: chosen } = useLook();
    return useMemo(() => {
        const look = surfaceLook(kind, glassStyle ?? chosen);
        return {
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
    }, [kind, glassStyle, chosen, pal]);
}

export function GlassSurface(props: GlassSurfaceProps) {
    return useLayer() ? <LayeredSurface {...props} /> : <StandaloneSurface {...props} />;
}

function LayeredSurface({ kind = 'reg', radius = 24, glassStyle, scale, dimmed, style, children, onLayout, ...rest }: GlassSurfaceProps) {
    const layer = useLayer()!;
    const { calm } = useLook();
    const look = useSurfaceLook(kind, glassStyle);
    const { ref, measure, place } = useScreenPlace();
    const [order] = useState(nextOrder);
    const size = useSharedValue([0, 0]);
    const steady = useSharedValue(1);
    const opacity = useSharedValue(calm ? 1 : 0);

    // Glass appears with a short fade, and a disabled control's glass dims with its content.
    useEffect(() => {
        const target = dimmed ? 0.5 : 1;
        opacity.set(calm ? target : withTiming(target, { duration: 260 }));
    }, [dimmed, calm, opacity]);

    useEffect(() => layer.add({ kind: 'surface', order, place, size, scale: scale ?? steady, opacity, radius, look }), [layer, order, place, size, scale, steady, opacity, radius, look]);

    const laidOut = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        size.set([width, height]);
        measure();
        onLayout?.(event);
    };

    return (
        <View ref={ref} onLayout={laidOut} style={[{ borderRadius: radius }, style]} {...rest}>
            {children}
        </View>
    );
}

function StandaloneSurface({ kind = 'reg', radius = 24, glassStyle, scale: _scale, dimmed: _dimmed, style, children, onLayout, ...rest }: GlassSurfaceProps) {
    const { liquid } = useGlass();
    const look = useSurfaceLook(kind, glassStyle);
    const { ref, measure, origin } = useScreenOrigin();
    const [size, setSize] = useState({ w: 0, h: 0 });
    const r = Math.min(radius, size.w / 2, size.h / 2);

    const uniforms = useDerivedValue(() => {
        const [x, y] = origin.value;
        return {
            ...liquid.value,
            ...look,
            uAt: [0, 0],
            uOrigin: [x - MARGIN, y - MARGIN],
            uInset: [MARGIN, MARGIN],
            uSize: [size.w, size.h],
            uRadius: r,
        };
    }, webDeps([size, r, look]));

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
