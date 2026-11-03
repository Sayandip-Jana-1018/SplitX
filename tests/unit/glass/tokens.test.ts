import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLASS_THEMES, oklchToSrgb } from '@/lib/glass/palette';

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
});
const unix = (path: string) => path.replaceAll('\\', '/');

describe('the colour tokens', () => {
    const accents = readFileSync('src/styles/themes/accents.css', 'utf8');
    const block = (id: string) => accents.split(`[data-palette="${id}"]`)[1]?.split('}')[0] ?? '';

    it('give each palette the hue the engine paints with', () => {
        for (const [id, theme] of Object.entries(GLASS_THEMES)) {
            const css = block(id);
            expect(css, id).toContain(`--h: ${theme.h};`);
            expect(css, id).toContain(`--c: ${theme.c};`);
            expect(css, id).toContain(`--fill-l: ${theme.l};`);
        }
    });

    it('keep the numeric accent the same colour as the filled accent', () => {
        for (const [id, theme] of Object.entries(GLASS_THEMES)) {
            const numbers = block(id).match(/--accent-500-rgb: (\d+), (\d+), (\d+);/)?.slice(1).map(Number);
            expect(numbers, id).toBeDefined();
            oklchToSrgb(theme.l, 0.2 * theme.c, theme.h).forEach((channel, index) => {
                expect(Math.abs(numbers![index] - channel * 255), id).toBeLessThanOrEqual(1);
            });
        }
    });

    it('keep saved palettes from before this design working', () => {
        for (const old of ['pastel-dreams', 'lavender-mist', 'midnight-indigo', 'tangerine', 'warm-coral']) {
            expect(accents).toContain(`[data-palette="${old}"]`);
        }
    });

    it('define the same tokens in dark and light', () => {
        const names = (file: string) => [...readFileSync(file, 'utf8').matchAll(/^\s+(--[a-z0-9-]+):/gm)].map((m) => m[1]).sort();
        expect(names('src/styles/themes/dark.css')).toEqual(names('src/styles/themes/light.css'));
    });
});

describe('one colour', () => {
    // Paper, email, a page that must work with no CSS, a brand's own mark, and the
    // throwaway test page may name colours. So may a QR code, which has to scan.
    const ALLOWED = [
        /journey\/print/,
        /lib\/email/,
        /global-error\.tsx/,
        /app\/error\.tsx/,
        /AuthKit\.tsx/,
        /receiptUpload\.ts/,
        /app\/layout\.tsx/,
        /glass-lab\//,
        /app\/\(app\)\/ops\//,
        /styles\/themes\//,
    ];
    const HEX = /#[0-9a-fA-F]{3,8}\b/g;
    const LEGIT = /^#(fff|ffffff|000|000000)$/i;

    it('names no colours in the screens, only the theme', () => {
        const offenders: string[] = [];
        for (const file of walk('src').map(unix).filter((f) => /\.(tsx|css)$/.test(f))) {
            if (ALLOWED.some((rule) => rule.test(file))) continue;
            readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
                for (const [match] of line.matchAll(HEX)) {
                    if (LEGIT.test(match)) continue;
                    // An HTML entity, or a link to a page section, isn't a colour.
                    if (/&#|href=|QRCodeSVG/.test(line)) continue;
                    offenders.push(`${file}:${index + 1} ${match}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });
});
