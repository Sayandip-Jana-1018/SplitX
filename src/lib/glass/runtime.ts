import type { GlassEngine } from '@/lib/glass/engine';

/**
 * The one engine on the page, for what needs to talk to it. A separate file, so
 * asking about the engine doesn't pull it into a page's first download.
 */
let current: GlassEngine | null = null;

export function setGlassEngine(engine: GlassEngine | null) {
    current = engine;
}

export function getGlassEngine(): GlassEngine | null {
    return current;
}
