/** The liquid behind every screen. It never scrolls; the glass above it moves. */
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';
import { useLook } from '~/theme/ThemeProvider';
import { effects } from './effects';
import { useGlass } from './GlassProvider';

export function LiquidWall() {
    const { tokens } = useLook();
    const { liquid: uniforms } = useGlass();
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
