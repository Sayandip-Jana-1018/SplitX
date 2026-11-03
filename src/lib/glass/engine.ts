import { frameIsDue, Governor, LOWEST_LEVEL, nextFrameDue, QUALITY } from '@/lib/glass/governor';
import { glassPalette, type GlassMode, type GlassPalette } from '@/lib/glass/palette';
import { BLIT_FS, DOWN_FS, DROPS_FS, FULL_VS, GLASS_FS, LIQUID_FS, QUAD_VS } from '@/lib/glass/shaders';
import { surfaceLook, type SurfaceLook } from '@/lib/glass/styles';

/**
 * The glass engine: one canvas beneath the page, drawing the floating liquid and,
 * under every element marked `data-glass`, real refracted glass. The page stays
 * ordinary markup; the engine reads where each element is.
 *
 * `locked`, the default, is what makes scrolling work. The browser scrolls a page
 * on its own thread, ahead of anything drawn here, so glass on a canvas fixed to
 * the screen trails its own text while you flick. So the canvas is part of the
 * page: it scrolls with the cards, on the same thread, and the engine moves it
 * back into view each frame. It is taller than the screen so a fast flick cannot
 * outrun it. A surface fixed to the screen, or inside a scroller of its own, cannot
 * ride on this canvas: the engine notices and marks it `data-glass-mode="css"`, and glass.css draws it.
 *
 * Anything can go wrong with a GPU, so nothing depends on it. Until the first frame
 * and after a lost context, `data-gl` is off and glass.css draws every surface.
 */
export type GlassCanvasMode = 'locked' | 'fixed' | 'css';
type GlassMotion = 'full' | 'calm';

export interface GlassStats {
    supported: boolean;
    mode: GlassCanvasMode;
    motion: GlassMotion;
    level: number;
    levelName: string;
    forcedLevel: number | null;
    fps: number;
    p95Ms: number;
    worstMs: number;
    capMs: number;
    surfaces: number;
    backing: [number, number];
    liquid: [number, number];
    overscan: number;
    dpr: number;
    gpu: string;
    losses: number;
    frames: number;
}

export interface GlassEngine {
    setMode(mode: GlassCanvasMode): void;
    /** Holds one quality level, or gives the choice back to the governor with null. */
    setLevel(level: number | null): void;
    stats(): GlassStats;
    resetStats(): void;
    /** What one frame costs the GPU right now, in milliseconds; null when there is no GPU to ask. */
    measureCost(): { liquidMs: number; screenMs: number } | null;
    /** Drops the GPU connection on purpose, to prove the page survives it. */
    simulateLostContext(): boolean;
    destroy(): void;
}

interface Surface {
    el: Element;
    parent: Surface | null;
    look: SurfaceLook;
    radius: number;
    fade: number;
    visible: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
    scaleSeen: number;
}

interface Target {
    tex: WebGLTexture | null;
    fbo: WebGLFramebuffer | null;
    w: number;
    h: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;
interface Program {
    prog: WebGLProgram;
    u: Uniforms;
}

const GLASS_SELECTOR = '[data-glass]:not([data-glass-mode="css"])';
const BLOB_SIZES = [0.36, 0.27, 0.21, 0.31, 0.17, 0.24, 0.19];
const MAX_SURFACES = 40;
const MAX_DROPS = 10;
const SHADOW_MARGIN = 44;
const OVERSCAN_SHARE = 0.2;
const OVERSCAN_MIN = 120;
const OVERSCAN_MAX = 260;
/** The observer's reach beyond the screen; must cover the largest overscan. */
const VISIBLE_MARGIN_PX = OVERSCAN_MAX + 80;
/** After the page changes, opacities and radii are read every frame for this long. */
const STYLE_HOT_MS = 1400;
const STYLE_EVERY_FRAMES = 20;
const CANVAS_FADE_MS = 240;
const RIPPLE_MS = 1100;
const TOUCH_MS = 850;
const GIVE_UP_AFTER_LOSSES = 3;
const FRAME_RING = 180;
const LEVEL_KEY = 'SplitX-glass-level';

const uniformNames = {
    liquid: ['uView', 'uL', 'uOver', 'uT', 'uGloss', 'uBloomA', 'uTouchA', 'uA0', 'uA1', 'uC1', 'uC2', 'uA0p', 'uA1p', 'uC1p', 'uC2p', 'uGlow', 'uRip', 'uTouch', 'uBloom', 'uBl'],
    down: ['uTex', 'uTexel'],
    blit: ['uTex'],
    glass: ['uQuad', 'uCanvas', 'uSharp', 'uSoft', 'uL', 'uT', 'uShadow', 'uLight', 'uTintK', 'uDisperseOn', 'uUnder', 'uTint', 'uAcc', 'uRimC', 'uR', 'uS', 'uG'],
    drops: ['uQuad', 'uCanvas', 'uSharp', 'uL', 'uLight', 'uRimC', 'uD', 'uDN'],
};

function readLevel(): number | null {
    try {
        const saved = localStorage.getItem(LEVEL_KEY);
        if (saved === null) return null;
        const level = Number(saved);
        return Number.isInteger(level) && level >= 0 && level <= LOWEST_LEVEL ? level : null;
    } catch {
        return null;
    }
}

function saveLevel(level: number) {
    try {
        localStorage.setItem(LEVEL_KEY, String(level));
    } catch {
        // Storage unavailable: the governor simply starts from its default next time.
    }
}

class Engine implements GlassEngine {
    private wall: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private gl: WebGLRenderingContext | null = null;
    private supported = true;
    private ready = false;
    private gaveUp = false;
    private losses = 0;
    private gpu = 'unknown';

    private programs: Record<keyof typeof uniformNames, Program> | null = null;
    private sharp: Target | null = null;
    private half: Target | null = null;
    private soft: Target | null = null;

    private mode: GlassCanvasMode = 'locked';
    private motion: GlassMotion = 'full';
    private governor: Governor;
    private forcedLevel: number | null = null;

    private raf = 0;
    private lastTick = 0;
    private frameDue = 0;
    private frameCount = 0;
    private liquidCount = 0;
    private painted = false;
    private lastSignature = NaN;
    private needsDraw = true;
    private t0 = performance.now() - Math.random() * 600_000;

    private cssW = 0;
    private cssH = 0;
    private viewH = 0;
    private maxViewH = 0;
    private lastWidth = 0;
    private over = 0;
    private dpr = 1;
    private appliedY = NaN;

    private pal: GlassPalette;
    private prevPal: GlassPalette;
    private themeMode: GlassMode = 'dark';
    private paletteId: string | null = null;
    private styleId: string | null = null;
    private light: [number, number] = [-0.52, -0.85];
    private lean: [number, number] = [0, 0];
    private lastPointer: [number, number] | null = null;
    private rip: { x: number; y: number; t0: number; reach: number } | null = null;
    private touch: { x: number; y: number; t0: number } | null = null;
    private blobs = new Float32Array(21);
    private dropData = new Float32Array(MAX_DROPS * 3);
    private dropCount = 0;
    private dropBox: [number, number, number, number] = [0, 0, 0, 0];
    private bloom: [number, number, number] = [0, 0, 1];
    private bloomAlpha = 0;

    private surfaces: Surface[] = [];
    private byEl = new Map<Element, Surface>();
    private dropEls: Element[] = [];
    private bloomEl: Element | null = null;
    private surfacesDirty = true;
    /** Surfaces already checked for whether they can ride on the canvas. */
    private riders = new WeakSet<Element>();
    private styleHotUntil = 0;
    private drawnSurfaces = 0;

    private ring = new Float32Array(FRAME_RING);
    private ringAt = 0;
    private ringFull = false;
    private frames = 0;

    private visibleObserver: IntersectionObserver | null = null;
    private pageObserver: MutationObserver;
    private themeObserver: MutationObserver;
    private reducedMotion: MediaQueryList;
    private bodyWasStatic = false;

    constructor() {
        this.governor = new Governor(readLevel() ?? (navigator.maxTouchPoints > 0 ? 2 : 1));

        // The wall is as tall as the page and clips, so the taller canvas can never lengthen it.
        this.wall = document.createElement('div');
        this.wall.setAttribute('data-glass-wall', '');
        this.wall.setAttribute('aria-hidden', 'true');
        this.canvas = document.createElement('canvas');
        this.wall.appendChild(this.canvas);
        if (getComputedStyle(document.body).position === 'static') {
            this.bodyWasStatic = true;
            document.body.style.position = 'relative';
        }
        document.body.prepend(this.wall);

        this.readTheme();
        this.pal = glassPalette(this.paletteId, this.themeMode);
        this.prevPal = this.pal;

        this.canvas.addEventListener('webglcontextlost', this.onLost);
        this.canvas.addEventListener('webglcontextrestored', this.onRestored);
        this.pageObserver = new MutationObserver(this.onPageChange);
        this.pageObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-glass', 'data-glass-mode', 'data-drop', 'data-petals'] });
        this.themeObserver = new MutationObserver(this.onThemeChange);
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'data-glass-style', 'data-motion'] });
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reducedMotion.addEventListener('change', this.onMotionPreference);
        window.addEventListener('pointerdown', this.onPointerDown, { passive: true });
        window.addEventListener('pointermove', this.onPointerMove, { passive: true });
        window.addEventListener('resize', this.onResize, { passive: true });
        window.addEventListener('scroll', this.onScroll, { passive: true });
        document.addEventListener('visibilitychange', this.onVisibility);
        if ('IntersectionObserver' in window) {
            this.visibleObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    const surface = this.byEl.get(entry.target);
                    if (surface) surface.visible = entry.isIntersecting;
                }
                this.needsDraw = true;
            }, { rootMargin: `${VISIBLE_MARGIN_PX}px 0px` });
        }

        this.supported = this.setUpGl();
        this.applyMode();
        this.start();
    }

    /* ── GPU setup ─────────────────────────────────────────────── */

    private setUpGl(): boolean {
        // A software renderer is worse than CSS glass, so it counts as no WebGL at all.
        const gl = this.gl ?? this.canvas.getContext('webgl', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: 'low-power',
            failIfMajorPerformanceCaveat: true,
        });
        if (!gl) return false;
        this.gl = gl;
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        if (debug) this.gpu = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));

        const liquid = this.link(FULL_VS, LIQUID_FS, uniformNames.liquid);
        const down = this.link(FULL_VS, DOWN_FS, uniformNames.down);
        const blit = this.link(FULL_VS, BLIT_FS, uniformNames.blit);
        const glass = this.link(QUAD_VS, GLASS_FS, uniformNames.glass);
        const drops = this.link(QUAD_VS, DROPS_FS, uniformNames.drops);
        if (!liquid || !down || !blit || !glass || !drops) return false;
        this.programs = { liquid, down, blit, glass, drops };

        // One buffer: a triangle over the whole target, then a unit rectangle.
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3, 0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.sharp = this.half = this.soft = null;
        this.cssW = 0;
        this.ready = true;
        return true;
    }

    private link(vsSource: string, fsSource: string, names: string[]): Program | null {
        const gl = this.gl!;
        const compile = (type: number, source: string) => {
            const shader = gl.createShader(type);
            if (!shader) return null;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
                console.warn('Glass shader:', gl.getShaderInfoLog(shader));
                return null;
            }
            return shader;
        };
        const vs = compile(gl.VERTEX_SHADER, vsSource);
        const fs = compile(gl.FRAGMENT_SHADER, fsSource);
        const prog = gl.createProgram();
        if (!vs || !fs || !prog) return null;
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, 'a');
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            if (!gl.isContextLost()) console.warn('Glass program:', gl.getProgramInfoLog(prog));
            return null;
        }
        const u: Uniforms = {};
        for (const name of names) u[name] = gl.getUniformLocation(prog, name);
        return { prog, u };
    }

    private makeTarget(previous: Target | null, w: number, h: number): Target {
        const gl = this.gl!;
        if (previous && previous.w === w && previous.h === h) return previous;
        if (previous) {
            gl.deleteTexture(previous.tex);
            gl.deleteFramebuffer(previous.fbo);
        }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { tex, fbo, w, h };
    }

    /* ── What the page and the person are doing ────────────────── */

    private onLost = (event: Event) => {
        event.preventDefault();
        this.stop();
        this.ready = false;
        this.losses++;
        if (this.losses >= GIVE_UP_AFTER_LOSSES) this.gaveUp = true;
        this.applyMode();
    };

    private onRestored = () => {
        if (this.gaveUp) return;
        this.supported = this.setUpGl();
        this.needsDraw = true;
        this.painted = false;
        this.applyMode();
        this.start();
    };

    private onPageChange = () => {
        this.surfacesDirty = true;
        this.styleHotUntil = performance.now() + STYLE_HOT_MS;
    };

    private onThemeChange = () => {
        const old = this.pal;
        const oldPaint = `${this.paletteId} ${this.themeMode}`;
        this.readTheme();
        for (const surface of this.surfaces) surface.look = this.lookOf(surface.el);
        this.needsDraw = true;
        this.setMotion(document.documentElement.getAttribute('data-motion') === 'calm' ? 'calm' : 'full');
        // A new kind of glass only changes the glass; a new colour or mode plays the ripple.
        if (oldPaint === `${this.paletteId} ${this.themeMode}`) return;
        this.pal = glassPalette(this.paletteId, this.themeMode);
        const w = window.innerWidth;
        const h = window.innerHeight;
        const from = this.lastPointer ?? [w / 2, h / 2];
        const reach = Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - from[0], y - from[1])));
        this.prevPal = old;
        if (this.canAnimate()) this.rip = { x: from[0], y: from[1], t0: performance.now(), reach: reach + 90 };
        if (!this.raf) this.drawStill();
    };

    private onPointerMove = (event: PointerEvent) => {
        if (event.pointerType === 'touch') return;
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        this.lean = [((event.clientX - w / 2) / w) * 1.5, ((event.clientY - h / 2) / h) * 1.1];
    };

    private onPointerDown = (event: PointerEvent) => {
        this.lastPointer = [event.clientX, event.clientY];
        if (this.canAnimate()) this.touch = { x: event.clientX, y: event.clientY, t0: performance.now() };
    };

    private onResize = () => {
        this.needsDraw = true;
        if (!this.raf) this.drawStill();
    };

    private onScroll = () => {
        this.needsDraw = true;
    };

    private onVisibility = () => {
        if (document.hidden) this.stop();
        else this.start();
    };

    private onMotionPreference = () => {
        this.applyMode();
        this.start();
    };

    private readTheme() {
        const html = document.documentElement;
        this.themeMode = html.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        this.paletteId = html.getAttribute('data-palette');
        this.styleId = html.getAttribute('data-glass-style');
    }

    private canAnimate(): boolean {
        return this.motion === 'full' && !this.reducedMotion.matches;
    }

    /* ── Which way this page is being drawn ────────────────────── */

    private drawsSurfaces(): boolean {
        return this.mode !== 'css' && this.canAnimate() && this.ready && !this.gaveUp;
    }

    private canvasScrolls(): boolean {
        return this.mode === 'locked' && this.canAnimate();
    }

    private applyMode() {
        const html = document.documentElement;
        const scrolls = this.canvasScrolls();
        this.wall.setAttribute('data-glass-wall', scrolls ? 'page' : 'screen');
        this.canvas.style.transform = '';
        this.appliedY = NaN;
        this.canvas.style.visibility = this.ready && !this.gaveUp ? '' : 'hidden';
        if (this.drawsSurfaces() && this.painted) html.setAttribute('data-gl', 'on');
        else html.removeAttribute('data-gl');
        if (this.canAnimate()) html.removeAttribute('data-glass-calm');
        else html.setAttribute('data-glass-calm', '');
        this.needsDraw = true;
        this.cssW = 0;
    }

    setMode(mode: GlassCanvasMode) {
        if (mode === this.mode) return;
        this.mode = mode;
        this.applyMode();
        if (!this.raf) this.start();
    }

    private setMotion(motion: GlassMotion) {
        if (motion === this.motion) return;
        this.motion = motion;
        this.applyMode();
        this.start();
    }

    setLevel(level: number | null) {
        this.forcedLevel = level === null ? null : Math.max(0, Math.min(LOWEST_LEVEL, level));
        this.needsDraw = true;
    }

    private get level(): number {
        return this.forcedLevel ?? this.governor.level;
    }

    /* ── The frame loop ────────────────────────────────────────── */

    private start() {
        if (this.raf || document.hidden || !this.supported || this.gaveUp || !this.ready) return;
        if (!this.canAnimate()) {
            this.stop();
            this.drawStill();
            return;
        }
        this.lastTick = 0;
        this.frameDue = 0;
        this.raf = requestAnimationFrame(this.tick);
    }

    private stop() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
    }

    private tick = (now: number) => {
        this.raf = requestAnimationFrame(this.tick);
        if (!frameIsDue(now, this.frameDue)) return;
        this.frameDue = nextFrameDue(now, this.frameDue, QUALITY[this.level].frameMs);
        if (this.lastTick) this.frameTook(now - this.lastTick);
        this.lastTick = now;
        this.render(now);
    };

    private frameTook(ms: number) {
        this.ring[this.ringAt] = ms;
        this.ringAt = (this.ringAt + 1) % FRAME_RING;
        if (this.ringAt === 0) this.ringFull = true;
        this.frames++;
        if (this.forcedLevel !== null) return;
        const before = this.governor.level;
        const event = this.governor.sample(ms);
        if (event === 'calm') {
            this.setMotion('calm');
        } else if (this.governor.level !== before) {
            this.needsDraw = true;
            saveLevel(this.governor.level);
        }
    }

    /** One picture, with no loop running: Calm, Reduced Motion, and the page that asks for less. */
    private drawStill() {
        if (!this.ready || this.gaveUp) return;
        this.fit();
        this.drawLiquid(performance.now());
        this.drawScreen(false);
        this.markPainted();
    }

    private render(now: number) {
        this.fit();
        this.moveCanvas();
        this.measure(now);
        const quality = QUALITY[this.level];
        this.liquidCount++;
        const rippling = !!this.rip || !!this.touch;
        const liquidDue = rippling || this.liquidCount % quality.liquidEvery === 0;
        if (!liquidDue && !this.needsDraw) return;
        this.needsDraw = false;
        if (liquidDue) this.drawLiquid(now);
        this.drawScreen(this.drawsSurfaces());
        this.frameCount++;
        this.markPainted();
    }

    private markPainted() {
        if (this.painted) return;
        this.painted = true;
        this.canvas.setAttribute('data-painted', '');
        // CSS glass steps aside only once the canvas has faded in, so there is never a moment with no glass at all.
        window.setTimeout(() => {
            if (this.drawsSurfaces() && this.painted) document.documentElement.setAttribute('data-gl', 'on');
        }, CANVAS_FADE_MS);
    }

    private fit() {
        const quality = QUALITY[this.level];
        const width = document.documentElement.clientWidth || window.innerWidth;
        const height = window.innerHeight;
        // A phone's address bar changes the height while scrolling. Keep the tallest seen,
        // or the canvas would be reallocated, and hitch, during the scroll it should survive.
        if (width !== this.lastWidth) {
            this.lastWidth = width;
            this.maxViewH = 0;
        }
        this.maxViewH = Math.max(this.maxViewH, height);
        this.viewH = this.maxViewH;
        const over = this.canvasScrolls() ? Math.max(OVERSCAN_MIN, Math.min(OVERSCAN_MAX, Math.round(this.viewH * OVERSCAN_SHARE))) : 0;
        const cssH = this.viewH + over * 2;
        const dpr = Math.min(window.devicePixelRatio || 1, quality.dpr);
        const bw = Math.round(width * dpr);
        const bh = Math.round(cssH * dpr);
        if (this.canvas.width !== bw || this.canvas.height !== bh) {
            this.canvas.width = bw;
            this.canvas.height = bh;
        }
        if (this.cssW !== width || this.cssH !== cssH || this.over !== over) {
            this.canvas.style.width = `${width}px`;
            this.canvas.style.height = `${cssH}px`;
            this.needsDraw = true;
        }
        this.cssW = width;
        this.cssH = cssH;
        this.over = over;
        this.dpr = bw / width;
        const sw = Math.max(2, Math.round(width * quality.liquid));
        const sh = Math.max(2, Math.round(cssH * quality.liquid));
        this.sharp = this.makeTarget(this.sharp, sw, sh);
        this.half = this.makeTarget(this.half, Math.max(2, sw >> 1), Math.max(2, sh >> 1));
        this.soft = this.makeTarget(this.soft, Math.max(2, sw >> 2), Math.max(2, sh >> 2));
    }

    /** Keeps the page-scrolled canvas over the screen. It is the same frame's scroll the surfaces were read at. */
    private moveCanvas() {
        if (!this.canvasScrolls()) return;
        const y = window.scrollY - this.over;
        if (y === this.appliedY) return;
        this.appliedY = y;
        this.canvas.style.transform = `translate3d(0,${y}px,0)`;
    }

    /* ── Reading the page ──────────────────────────────────────── */

    private rescan() {
        this.surfacesDirty = false;
        const found = document.querySelectorAll(GLASS_SELECTOR);
        const next = new Map<Element, Surface>();
        const list: Surface[] = [];
        for (const el of found) {
            if (!this.canRide(el)) continue;
            const known = this.byEl.get(el);
            const surface: Surface = known ?? {
                el,
                parent: null,
                look: this.lookOf(el),
                radius: 0,
                fade: 1,
                visible: !this.visibleObserver,
                x: 0,
                y: 0,
                w: 0,
                h: 0,
                scaleSeen: 1,
            };
            if (known) surface.look = this.lookOf(el);
            else this.visibleObserver?.observe(el);
            next.set(el, surface);
            list.push(surface);
        }
        for (const [el] of this.byEl) if (!next.has(el)) this.visibleObserver?.unobserve(el);
        for (const surface of list) {
            const above = surface.el.parentElement?.closest(GLASS_SELECTOR);
            surface.parent = above ? next.get(above) ?? null : null;
        }
        this.byEl = next;
        this.surfaces = list;
        this.dropEls = Array.from(document.querySelectorAll('[data-drop]')).filter((el) => !el.closest('[data-glass-mode="css"]')).slice(0, MAX_DROPS);
        this.bloomEl = document.querySelector('[data-petals]');
        this.needsDraw = true;
    }

    private lookOf(el: Element): SurfaceLook {
        return surfaceLook(el.getAttribute('data-glass'), el.getAttribute('data-glass-sample') ?? this.styleId);
    }

    /**
     * Only what moves with the page can be drawn on the page's canvas. Anything fixed, sticky
     * or inside a box that clips or scrolls goes to CSS glass, which the browser moves itself.
     */
    private canRide(el: Element): boolean {
        if (this.riders.has(el)) return true;
        let rides = !el.closest('[data-glass-mode="css"]');
        for (let node: Element | null = el; rides && node && node !== document.body; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.position === 'fixed' || style.position === 'sticky') rides = false;
            if (node !== el && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) rides = false;
        }
        if (rides) this.riders.add(el);
        else el.setAttribute('data-glass-mode', 'css');
        return rides;
    }

    private readStyle(surface: Surface, width: number, height: number) {
        const el = surface.el as HTMLElement;
        const style = getComputedStyle(el);
        const raw = style.borderTopLeftRadius;
        let radius = parseFloat(raw) || 0;
        if (raw.includes('%')) radius = (radius / 100) * Math.min(el.offsetWidth, el.offsetHeight);
        surface.scaleSeen = el.offsetWidth ? width / el.offsetWidth : 1;
        surface.radius = Math.min(radius * surface.scaleSeen, width / 2, height / 2);
        surface.fade = fadeOf(el, style);
    }

    /** Where everything is, this frame. Reading rectangles is cheap (0.2 ms measured); styles are read only when they may have changed. */
    private measure(now: number) {
        if (this.surfacesDirty) this.rescan();
        if (!this.drawsSurfaces()) return;
        const readStyles = now < this.styleHotUntil || this.frameCount % STYLE_EVERY_FRAMES === 0;
        let signature = 0;
        let drawn = 0;
        for (const surface of this.surfaces) {
            if (!surface.visible || drawn >= MAX_SURFACES) continue;
            const box = surface.el.getBoundingClientRect();
            surface.x = box.left;
            surface.y = box.top + this.over;
            surface.w = box.width;
            surface.h = box.height;
            if (readStyles) this.readStyle(surface, box.width, box.height);
            signature += box.left * 3 + box.top * 5 + box.width * 7 + box.height * 11 + surface.fade * 13;
            drawn++;
        }
        this.drawnSurfaces = drawn;
        signature += drawn;
        if (signature !== this.lastSignature) {
            this.lastSignature = signature;
            this.needsDraw = true;
        }
        this.measureHero();
    }

    private measureHero() {
        let count = 0;
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const el of this.dropEls) {
            const box = el.getBoundingClientRect();
            if (box.width < 1) continue;
            const r = (box.width / 2) * fadeOf(el, getComputedStyle(el));
            const x = box.left + box.width / 2;
            const y = box.top + box.height / 2 + this.over;
            this.dropData[count * 3] = x;
            this.dropData[count * 3 + 1] = y;
            this.dropData[count * 3 + 2] = r;
            // The field reaches past each drop, so the box leaves room for its soft shadow.
            left = Math.min(left, x - r * 1.6);
            top = Math.min(top, y - r * 1.6);
            right = Math.max(right, x + r * 1.6);
            bottom = Math.max(bottom, y + r * 1.6);
            count++;
        }
        this.dropCount = count;
        this.dropBox = [left, top, right - left, bottom - top];
        this.bloomAlpha = 0;
        if (this.bloomEl) {
            const box = this.bloomEl.getBoundingClientRect();
            if (box.width > 0) {
                this.bloom = [box.left + box.width / 2, box.top + box.height / 2, Math.max(box.width / 340, 0.01)];
                this.bloomAlpha = fadeOf(this.bloomEl, getComputedStyle(this.bloomEl));
            }
        }
    }

    /* ── Drawing ───────────────────────────────────────────────── */

    /** Seven masses, each on its own slow path. */
    private floatBlobs(t: number, w: number, h: number) {
        const m = Math.min(w, h);
        for (let i = 0; i < 7; i++) {
            const a = i * 2.399;
            const sx = 0.075 + 0.028 * ((i * 3) % 5);
            const sy = 0.062 + 0.024 * ((i * 2) % 5);
            this.blobs[i * 3] = w * (0.5 + 0.52 * Math.sin(t * sx + a));
            this.blobs[i * 3 + 1] = h * (0.5 + 0.54 * Math.sin(t * sy + a * 1.37 + 1.1));
            this.blobs[i * 3 + 2] = m * BLOB_SIZES[i] * (1 + 0.09 * Math.sin(t * 0.42 + i * 1.3));
        }
    }

    private drawLiquid(now: number) {
        const gl = this.gl!;
        const { liquid, down } = this.programs!;
        const t = (now - this.t0) / 1000;
        const w = this.cssW;
        const h = this.viewH;
        this.floatBlobs(t, w, h);

        // The light drifts on its own and leans toward the pointer.
        const lx = -0.52 + Math.sin(t * 0.3) * 0.42 + this.lean[0];
        const ly = -0.85 + Math.cos(t * 0.23) * 0.16 + this.lean[1];
        const len = Math.hypot(lx, ly) || 1;
        this.light[0] += (lx / len - this.light[0]) * 0.1;
        this.light[1] += (ly / len - this.light[1]) * 0.1;

        const sharp = this.sharp!;
        gl.disable(gl.BLEND);
        gl.useProgram(liquid.prog);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sharp.fbo);
        gl.viewport(0, 0, sharp.w, sharp.h);
        const u = liquid.u;
        const pal = this.pal;
        const prev = this.prevPal;
        gl.uniform2f(u.uView, w, h);
        gl.uniform2f(u.uL, this.light[0], this.light[1]);
        gl.uniform1f(u.uOver, this.over);
        gl.uniform1f(u.uT, t);
        // The masses grow with the screen and so would their highlight: a glint on a phone is a white band on a laptop.
        gl.uniform1f(u.uGloss, Math.max(0.35, Math.min(0.7, 300 / Math.min(w, h))));
        gl.uniform3fv(u.uA0, pal.a0);
        gl.uniform3fv(u.uA1, pal.a1);
        gl.uniform3fv(u.uC1, pal.c1);
        gl.uniform3fv(u.uC2, pal.c2);
        gl.uniform3fv(u.uA0p, prev.a0);
        gl.uniform3fv(u.uA1p, prev.a1);
        gl.uniform3fv(u.uC1p, prev.c1);
        gl.uniform3fv(u.uC2p, prev.c2);
        gl.uniform3fv(u.uGlow, pal.glow);
        gl.uniform3fv(u.uBl, this.blobs);
        gl.uniform3f(u.uBloom, this.bloom[0], this.bloom[1], this.bloom[2]);
        gl.uniform1f(u.uBloomA, this.bloomAlpha);

        let ripX = 0;
        let ripY = 0;
        let ripZ = -1;
        if (this.rip) {
            const p = (now - this.rip.t0) / RIPPLE_MS;
            if (p >= 1) {
                this.rip = null;
            } else {
                ripX = this.rip.x;
                ripY = this.rip.y;
                ripZ = (1 - (1 - p) ** 3) * this.rip.reach;
            }
        }
        gl.uniform3f(u.uRip, ripX, ripY, ripZ);
        let touchX = 0;
        let touchY = 0;
        let touchZ = 0;
        let touchA = 0;
        if (this.touch) {
            const p = (now - this.touch.t0) / TOUCH_MS;
            if (p >= 1) {
                this.touch = null;
            } else {
                touchX = this.touch.x;
                touchY = this.touch.y;
                touchZ = (1 - (1 - p) ** 2) * 170;
                touchA = 1 - p;
            }
        }
        gl.uniform3f(u.uTouch, touchX, touchY, touchZ);
        gl.uniform1f(u.uTouchA, touchA);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Halved twice: the blur frosted glass reads.
        gl.useProgram(down.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(down.u.uTex, 0);
        let from = sharp;
        for (const to of [this.half!, this.soft!]) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
            gl.viewport(0, 0, to.w, to.h);
            gl.bindTexture(gl.TEXTURE_2D, from.tex);
            gl.uniform2f(down.u.uTexel, 0.5 / from.w, 0.5 / from.h);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            from = to;
        }
    }

    private drawScreen(withSurfaces: boolean) {
        const gl = this.gl!;
        const { blit, glass, drops } = this.programs!;
        const sharp = this.sharp!;
        const soft = this.soft!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.BLEND);
        gl.useProgram(blit.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sharp.tex);
        gl.uniform1i(blit.u.uTex, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!withSurfaces) return;

        gl.enable(gl.BLEND);
        const pal = this.pal;
        if (this.dropCount > 0) {
            const u = drops.u;
            gl.useProgram(drops.prog);
            gl.uniform2f(u.uCanvas, this.cssW, this.cssH);
            gl.uniform1i(u.uSharp, 0);
            gl.uniform2f(u.uL, this.light[0], this.light[1]);
            gl.uniform1f(u.uLight, pal.light);
            gl.uniform3fv(u.uRimC, pal.rim);
            gl.uniform3fv(u.uD, this.dropData);
            gl.uniform1i(u.uDN, this.dropCount);
            gl.uniform4f(u.uQuad, this.dropBox[0], this.dropBox[1], this.dropBox[2], this.dropBox[3]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 3, 4);
        }

        const u = glass.u;
        gl.useProgram(glass.prog);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, soft.tex);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(u.uSharp, 0);
        gl.uniform1i(u.uSoft, 1);
        gl.uniform2f(u.uCanvas, this.cssW, this.cssH);
        gl.uniform2f(u.uL, this.light[0], this.light[1]);
        gl.uniform1f(u.uT, (performance.now() - this.t0) / 1000);
        gl.uniform1f(u.uShadow, pal.shadow);
        gl.uniform1f(u.uLight, pal.light);
        gl.uniform1f(u.uTintK, pal.tintK);
        gl.uniform1f(u.uDisperseOn, QUALITY[this.level].disperse ? 1 : 0);
        gl.uniform3fv(u.uAcc, pal.acc);
        gl.uniform3fv(u.uRimC, pal.rim);
        let drawn = 0;
        for (const s of this.surfaces) {
            if (!s.visible || s.w < 2 || s.h < 2 || s.fade <= 0.003) continue;
            if (drawn++ >= MAX_SURFACES) break;
            const { look } = s;
            gl.uniform4f(u.uQuad, s.x - SHADOW_MARGIN, s.y - SHADOW_MARGIN, s.w + SHADOW_MARGIN * 2, s.h + SHADOW_MARGIN * 2);
            gl.uniform4f(u.uR, s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2);
            gl.uniform4f(u.uS, s.radius, look.frost, look.tint, s.fade);
            gl.uniform4f(u.uG, look.refract, look.disperse, look.rim, look.wobble);
            gl.uniform1f(u.uUnder, s.parent ? s.parent.look.tint : 0);
            gl.uniform3fv(u.uTint, look.colored ? pal.tinted : pal.tint);
            gl.drawArrays(gl.TRIANGLE_STRIP, 3, 4);
        }
    }

    /* ── For the test page ─────────────────────────────────────── */

    resetStats() {
        this.ring.fill(0);
        this.ringAt = 0;
        this.ringFull = false;
        this.frames = 0;
    }

    stats(): GlassStats {
        const count = this.ringFull ? FRAME_RING : this.ringAt;
        const sorted = Array.from(this.ring.subarray(0, count)).sort((a, b) => a - b);
        const mean = count ? sorted.reduce((sum, ms) => sum + ms, 0) / count : 0;
        return {
            supported: this.supported,
            mode: this.mode,
            motion: this.canAnimate() ? 'full' : 'calm',
            level: this.level,
            levelName: QUALITY[this.level].name,
            forcedLevel: this.forcedLevel,
            fps: mean ? 1000 / mean : 0,
            p95Ms: count ? sorted[Math.floor(count * 0.95)] : 0,
            worstMs: count ? sorted[count - 1] : 0,
            capMs: this.governor.capMs,
            surfaces: this.drawnSurfaces,
            backing: [this.canvas.width, this.canvas.height],
            liquid: [this.sharp?.w ?? 0, this.sharp?.h ?? 0],
            overscan: this.over,
            dpr: this.dpr,
            gpu: this.gpu,
            losses: this.losses,
            frames: this.frames,
        };
    }

    measureCost() {
        if (!this.ready || !this.programs) return null;
        const gl = this.gl!;
        const pixel = new Uint8Array(4);
        // Waiting for the GPU costs far more than one draw, and varies. So each reading waits
        // once for a run of draws, and the wait, measured on one pixel, is taken off.
        const timed = (draw: () => void) => {
            const times: number[] = [];
            for (let i = 0; i < 5; i++) {
                const start = performance.now();
                for (let n = 0; n < 8; n++) draw();
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                times.push((performance.now() - start) / 8);
            }
            return times.sort((a, b) => a - b)[2];
        };
        const waiting = timed(() => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, 1, 1);
            gl.useProgram(this.programs!.blit.prog);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        });
        const now = performance.now();
        const liquidMs = Math.max(0, timed(() => this.drawLiquid(now)) - waiting);
        const screenMs = Math.max(0, timed(() => this.drawScreen(this.drawsSurfaces())) - waiting);
        this.needsDraw = true;
        return { liquidMs, screenMs };
    }

    simulateLostContext(): boolean {
        const lose = this.gl?.getExtension('WEBGL_lose_context');
        if (!lose) return false;
        lose.loseContext();
        window.setTimeout(() => lose.restoreContext(), 1500);
        return true;
    }

    destroy() {
        this.stop();
        this.visibleObserver?.disconnect();
        this.pageObserver.disconnect();
        this.themeObserver.disconnect();
        this.reducedMotion.removeEventListener('change', this.onMotionPreference);
        this.canvas.removeEventListener('webglcontextlost', this.onLost);
        this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('scroll', this.onScroll);
        document.removeEventListener('visibilitychange', this.onVisibility);
        document.documentElement.removeAttribute('data-gl');
        document.documentElement.removeAttribute('data-glass-calm');
        this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
        this.wall.remove();
        if (this.bodyWasStatic) document.body.style.position = '';
    }
}

/** The surface's own opacity, and that of every wrapper animating it in with `data-fade`. */
function fadeOf(el: Element, style: CSSStyleDeclaration): number {
    let alpha = parseFloat(style.opacity);
    if (Number.isNaN(alpha)) alpha = 1;
    for (let wrapper = el.parentElement?.closest('[data-fade]'); wrapper; wrapper = wrapper.parentElement?.closest('[data-fade]')) {
        alpha *= parseFloat(getComputedStyle(wrapper).opacity) || 0;
    }
    return alpha;
}

export function createGlassEngine(): GlassEngine {
    return new Engine();
}
