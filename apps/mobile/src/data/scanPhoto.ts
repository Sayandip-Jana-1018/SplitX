/**
 * A photo made ready to scan: its long side at most 2,000 pixels (all the text a bill needs, and
 * what the reading model looks at) and a JPEG, so it travels as a few hundred KB rather than the
 * camera's several MB. It is shrunk as it is decoded, so the full photo is never held in memory.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const LONG_SIDE = 2000;

export async function photoForScan(uri: string, width: number, height: number): Promise<string> {
    const tall = height >= width;
    const context = ImageManipulator.manipulate(uri, tall ? { maxHeight: LONG_SIDE } : { maxWidth: LONG_SIDE });
    // The camera doesn't always say how big its photo is (0 × 0): then decoding has already shrunk it.
    if (width > 0 && height > 0 && Math.max(width, height) > LONG_SIDE) {
        context.resize(tall ? { height: LONG_SIDE, width: null } : { width: LONG_SIDE, height: null });
    }
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.72, base64: true });
    if (!saved.base64) throw new Error('The photo could not be read.');
    return `data:image/jpeg;base64,${saved.base64}`;
}
