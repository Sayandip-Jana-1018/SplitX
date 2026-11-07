/** The liquid behind every screen. It never scrolls; the glass above it moves. */
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { useLook } from '~/theme/ThemeProvider';
import { effects } from './effects';
import { useGlass } from './GlassProvider';
import { liquidUniforms } from './uniforms';

export function LiquidWall() {
    const { pal, tokens } = useLook();
    const { time, width, height } = useGlass();
    const uniforms = useDerivedValue(() => liquidUniforms(time.value, width, height, pal), [pal, width, height]);
    return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tokens.bg }]} pointerEvents="none">
            <Canvas style={StyleSheet.absoluteFill}>
                <Fill>
                    <Shader source={effects().liquid} uniforms={uniforms} />
                </Fill>
            </Canvas>
        </View>
    );
}
