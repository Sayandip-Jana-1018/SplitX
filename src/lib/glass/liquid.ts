/**
 * How the liquid moves: seven masses, each on its own slow path, and a light that drifts.
 * The web's engine and the phone's both draw from this, so they show the same liquid.
 * 'worklet' lets the phone run these on its UI thread; on the web it is an unused string.
 */

const BLOB_SIZES = [0.36, 0.27, 0.21, 0.31, 0.17, 0.24, 0.19];

/** Writes each mass's x, y and radius, in the screen's own units, into `out`. */
export function floatBlobs(t: number, w: number, h: number, out: Float32Array | number[]): void {
    'worklet';
    const m = Math.min(w, h);
    for (let i = 0; i < 7; i++) {
        const a = i * 2.399;
        const sx = 0.075 + 0.028 * ((i * 3) % 5);
        const sy = 0.062 + 0.024 * ((i * 2) % 5);
        out[i * 3] = w * (0.5 + 0.52 * Math.sin(t * sx + a));
        out[i * 3 + 1] = h * (0.5 + 0.54 * Math.sin(t * sy + a * 1.37 + 1.1));
        out[i * 3 + 2] = m * BLOB_SIZES[i] * (1 + 0.09 * Math.sin(t * 0.42 + i * 1.3));
    }
}

/** Where the light comes from at time t, before anything leans it: x and y, not yet unit length. */
export function lightBase(t: number): [number, number] {
    'worklet';
    return [-0.52 + Math.sin(t * 0.3) * 0.42, -0.85 + Math.cos(t * 0.23) * 0.16];
}
