/**
 * Copies what on-device receipt reading needs into public/tesseract/, so the
 * browser loads it from this site and not from a CDN: the Content-Security-
 * Policy then names no other origin for scripts. Runs before `next dev` and
 * `next build`, from the pinned packages in node_modules, so the files always
 * match the library that loads them (they are not committed).
 *
 *   worker.min.js            tesseract.js's web worker
 *   core/*.wasm.js           the engine's LSTM builds: relaxed SIMD, SIMD and
 *                            plain. The worker picks the one the browser runs.
 *   lang/eng.traineddata.gz  English, the "best_int" model tesseract.js uses
 *                            by default.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const modules = join(process.cwd(), 'node_modules');
const target = join(process.cwd(), 'public', 'tesseract');

const files = [
    [join(modules, 'tesseract.js', 'dist', 'worker.min.js'), join(target, 'worker.min.js')],
    ...['relaxedsimd-lstm', 'simd-lstm', 'lstm'].map((build) => [
        join(modules, 'tesseract.js-core', `tesseract-core-${build}.wasm.js`),
        join(target, 'core', `tesseract-core-${build}.wasm.js`),
    ]),
    [join(modules, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), join(target, 'lang', 'eng.traineddata.gz')],
];

for (const [from, to] of files) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
}
console.log(`tesseract: ${files.length} files copied to public/tesseract`);
