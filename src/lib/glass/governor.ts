/**
 * The quality governor: watches how long real frames take and changes the
 * engine's quality before a stutter shows. Pure, so every rule here is tested
 * without a GPU (tests/unit/glass/governor.test.ts).
 */
export interface QualityLevel {
    name: string;
    /** The sharpest the screen is drawn; a phone's 3x display is not worth paying for. */
    dpr: number;
    /** The liquid's resolution, as a share of the page's CSS pixels. */
    liquid: number;
    /** Colour fringing at the rim, which takes three reads of the liquid instead of one. */
    disperse: boolean;
    /** How long one frame may take at this level. */
    frameMs: number;
    /** Draw the liquid on every nth frame; the glass still follows every frame. */
    liquidEvery: number;
}

export const QUALITY: readonly QualityLevel[] = [
    { name: 'full', dpr: 2, liquid: 0.5, disperse: true, frameMs: 16.7, liquidEvery: 1 },
    { name: 'high', dpr: 1.75, liquid: 0.5, disperse: true, frameMs: 16.7, liquidEvery: 1 },
    { name: 'balanced', dpr: 1.5, liquid: 0.33, disperse: false, frameMs: 16.7, liquidEvery: 1 },
    { name: 'light', dpr: 1.25, liquid: 0.33, disperse: false, frameMs: 16.7, liquidEvery: 2 },
    { name: 'low', dpr: 1, liquid: 0.25, disperse: false, frameMs: 33.4, liquidEvery: 1 },
];

export const LOWEST_LEVEL = QUALITY.length - 1;

const WINDOW_FRAMES = 40;
/** More than this share of slow frames in a window means the level is too high. */
const TOO_SLOW = 0.2;
/** Below this share a window counts as calm enough to try going up later. */
const QUITE_SMOOTH = 0.05;
const SLOW_FACTOR = 1.5;
/** A gap this long is a hidden tab or a long task, and says nothing about drawing. */
const IGNORE_OVER_MS = 250;
const FIRST_HOLD_WINDOWS = 8;
const LOCK_AFTER_FAILED_RAISES = 2;
/** How many windows a drop still counts as the result of the raise before it. */
const RAISE_GRACE_WINDOWS = 2;
const STRUGGLING_WINDOWS_FOR_CALM = 3;

/** Frame times jitter, so a frame this early still counts as on time. */
const FRAME_SLACK_MS = 2;

export function frameIsDue(now: number, due: number): boolean {
    return now >= due - FRAME_SLACK_MS;
}

/**
 * When the next frame is due. How late this one was comes off the next wait, so any
 * screen averages the level's rate: a 90 Hz phone draws two frames in three, not one in two.
 * The carry is capped, so a long stall is not followed by a burst of catching up.
 */
export function nextFrameDue(now: number, due: number, frameMs: number): number {
    return now + frameMs - Math.max(0, Math.min(now - due, frameMs / 2));
}

export type GovernorEvent = 'drop' | 'raise' | 'undo-drop' | 'calm' | null;

function median(sorted: number[]): number {
    return sorted[Math.floor(sorted.length / 2)];
}

export class Governor {
    level: number;
    /** Set when something else holds the frame rate down, such as battery saver. */
    capMs = 0;
    private frames: number[] = [];
    private smoothWindows = 0;
    private holdWindows = FIRST_HOLD_WINDOWS;
    private failedRaises = 0;
    private windowsSinceRaise = Infinity;
    private strugglingAtBottom = 0;
    private droppedFrom: { level: number; median: number } | null = null;

    constructor(startLevel = 0) {
        this.level = Math.max(0, Math.min(LOWEST_LEVEL, startLevel));
    }

    get targetMs(): number {
        return Math.max(QUALITY[this.level].frameMs, this.capMs);
    }

    /** One frame's length. Returns what changed, if anything; `level` holds the result. */
    sample(ms: number): GovernorEvent {
        if (ms > IGNORE_OVER_MS) {
            this.frames = [];
            return null;
        }
        this.frames.push(ms);
        if (this.frames.length < WINDOW_FRAMES) return null;
        const sorted = this.frames.sort((a, b) => a - b);
        this.frames = [];
        return this.judge(sorted);
    }

    private judge(sorted: number[]): GovernorEvent {
        const limit = this.targetMs * SLOW_FACTOR;
        const slowShare = sorted.filter((ms) => ms > limit).length / sorted.length;
        const typical = median(sorted);
        this.windowsSinceRaise++;

        if (this.droppedFrom) {
            const before = this.droppedFrom;
            this.droppedFrom = null;
            // Lowering quality changed nothing and the typical frame is itself slow, so drawing
            // was never the limit: battery saver or a slow screen is. Put the picture back and
            // accept that rate. A typical frame that is fine means some frames are slow, and the
            // frame cap hides any improvement in the median, so that is the ordinary path below.
            if (slowShare > TOO_SLOW && typical > before.median * 0.9 && typical > limit) {
                this.level = before.level;
                this.capMs = typical;
                this.smoothWindows = 0;
                return 'undo-drop';
            }
        }

        if (slowShare > TOO_SLOW) {
            this.smoothWindows = 0;
            if (this.level === LOWEST_LEVEL) {
                this.strugglingAtBottom++;
                return this.strugglingAtBottom >= STRUGGLING_WINDOWS_FOR_CALM ? 'calm' : null;
            }
            if (this.windowsSinceRaise <= RAISE_GRACE_WINDOWS) {
                this.failedRaises++;
                this.holdWindows *= 2;
            }
            this.droppedFrom = { level: this.level, median: typical };
            this.level++;
            return 'drop';
        }

        this.strugglingAtBottom = 0;
        if (slowShare > QUITE_SMOOTH) {
            this.smoothWindows = 0;
            return null;
        }
        this.smoothWindows++;
        if (this.level > 0 && this.failedRaises < LOCK_AFTER_FAILED_RAISES && this.smoothWindows >= this.holdWindows) {
            this.level--;
            this.smoothWindows = 0;
            this.windowsSinceRaise = 0;
            return 'raise';
        }
        return null;
    }
}
