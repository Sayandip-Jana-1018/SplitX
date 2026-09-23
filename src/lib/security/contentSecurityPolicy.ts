/**
 * The Content-Security-Policy every page carries, and how reports of its
 * violations are read.
 *
 * What it allows, and why:
 * - scripts from the site itself. `'unsafe-inline'` stays for scripts: Next.js
 *   writes its page data as inline scripts, and the alternative (a nonce on
 *   every response) would make every page render per request, including the
 *   landing and sign-in pages that are served prerendered today. React escapes
 *   what it renders and no page puts user text into raw HTML, so the policy's
 *   job is the rest: no scripts, requests, frames or form posts to anyone the
 *   list below doesn't name, which stops an injected script sending data away.
 * - `'wasm-unsafe-eval'`: on-device receipt reading (Tesseract) compiles
 *   WebAssembly. Its worker, engine and language data are served by the site
 *   itself (scripts/tesseract-assets.mjs), so no CDN is named anywhere, and
 *   the worker starts from its own file, so workers need no blob: source.
 * - Supabase: receipt and avatar photos are read from, and uploaded straight
 *   to, its storage.
 * - Google and GitHub: profile photos of people who signed in with them.
 *
 * It is sent as Content-Security-Policy-Report-Only first (next.config.ts):
 * browsers report what it would block to /api/csp-report, and it is enforced
 * once production shows none from the app itself.
 */

export const CSP_REPORT_PATH = '/api/csp-report';

export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://res.cloudinary.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
].join('; ');

/**
 * The page may use the camera (receipt scanning) and the microphone (voice
 * entry), and only on this site; nothing else.
 */
export const PERMISSIONS_POLICY = 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()';

const DIRECTIVES = new Set([
    'default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr',
    'img-src', 'font-src', 'connect-src', 'media-src', 'worker-src', 'manifest-src', 'frame-src', 'frame-ancestors',
    'object-src', 'base-uri', 'form-action', 'child-src', 'prefetch-src',
]);

export interface CspViolation {
    directive: string;
    /** What kind of source was blocked; a small fixed set, safe as a metric label. */
    source: 'inline' | 'eval' | 'wasm-eval' | 'data' | 'blob' | 'self' | 'external' | 'other';
    /** The blocked origin, when it was a URL. For logs, never a label. */
    blockedOrigin: string | null;
    /** The page's path, without its query. */
    page: string | null;
}

function classify(blocked: string, pageOrigin: string | null): Pick<CspViolation, 'source' | 'blockedOrigin'> {
    if (blocked === 'inline') return { source: 'inline', blockedOrigin: null };
    if (blocked === 'eval') return { source: 'eval', blockedOrigin: null };
    if (blocked === 'wasm-eval') return { source: 'wasm-eval', blockedOrigin: null };
    if (blocked === 'data' || blocked.startsWith('data:')) return { source: 'data', blockedOrigin: null };
    if (blocked === 'blob' || blocked.startsWith('blob:')) return { source: 'blob', blockedOrigin: null };
    try {
        const origin = new URL(blocked).origin;
        return { source: origin === pageOrigin ? 'self' : 'external', blockedOrigin: origin };
    } catch {
        return { source: 'other', blockedOrigin: null };
    }
}

function pathOf(url: unknown): { origin: string | null; path: string | null } {
    if (typeof url !== 'string') return { origin: null, path: null };
    try {
        const parsed = new URL(url);
        return { origin: parsed.origin, path: parsed.pathname };
    } catch {
        return { origin: null, path: null };
    }
}

/**
 * Reads a violation report in either format browsers send: the older
 * `application/csp-report` ({ "csp-report": {...} }) or the Reporting API's
 * `application/reports+json` ([{ type: "csp-violation", body: {...} }]).
 * At most 20 violations per request are read.
 */
export function parseCspReports(payload: unknown): CspViolation[] {
    const bodies: Record<string, unknown>[] = [];
    if (Array.isArray(payload)) {
        for (const report of payload.slice(0, 20)) {
            if (report && typeof report === 'object' && (report as { type?: unknown }).type === 'csp-violation') {
                const body = (report as { body?: unknown }).body;
                if (body && typeof body === 'object') bodies.push(body as Record<string, unknown>);
            }
        }
    } else if (payload && typeof payload === 'object') {
        const body = (payload as Record<string, unknown>)['csp-report'];
        if (body && typeof body === 'object') bodies.push(body as Record<string, unknown>);
    }

    return bodies.map((body) => {
        const rawDirective = String(body.effectiveDirective ?? body['effective-directive'] ?? body['violated-directive'] ?? '')
            .trim()
            .split(/\s+/)[0]
            .toLowerCase();
        const page = pathOf(body.documentURL ?? body['document-uri']);
        const blocked = String(body.blockedURL ?? body['blocked-uri'] ?? '');
        return {
            directive: DIRECTIVES.has(rawDirective) ? rawDirective : 'other',
            ...classify(blocked, page.origin),
            page: page.path,
        };
    });
}
