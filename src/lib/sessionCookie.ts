/**
 * The name of the session cookie (lib/auth.ts). A production build is served
 * over HTTPS (Vercel), so its cookie carries the __Secure- prefix. next-auth
 * also salts the session token with this name, so a token made under one name
 * is no session under the other: anything that signs a session for a test must
 * use this name too (D-100).
 */
export function sessionCookieName(production = process.env.NODE_ENV === 'production'): string {
    return production ? '__Secure-authjs.session-token' : 'authjs.session-token';
}
