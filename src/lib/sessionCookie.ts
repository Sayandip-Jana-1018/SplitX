/**
 * The name of the session cookie (lib/auth.ts). A production build is served
 * over HTTPS (Vercel, CloudFront), so its cookie carries the __Secure- prefix;
 * a Kind cluster runs the same production build. next-auth also salts the
 * session token with this name, so a token made under one name is no session
 * under the other: kind-e2e's operator check signs its sessions with this name
 * too (scripts/lib/e2e.mjs, D-100).
 */
export function sessionCookieName(production = process.env.NODE_ENV === 'production'): string {
    return production ? '__Secure-authjs.session-token' : 'authjs.session-token';
}
