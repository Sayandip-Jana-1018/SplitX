'use client';

import { useEffect, useState } from 'react';

/**
 * Root error boundary.
 *
 * A stale service-worker cache can hand the browser chunks from a previous
 * deploy, which React reports as a minified element/hydration error. When the
 * failure looks like that, we clear the caches and reload once — silently —
 * instead of showing the user a wall of text. Everything here is inline so the
 * screen still renders even when the app's own chunks are broken.
 */

const RELOAD_FLAG = 'splitx:self-heal';
const STALE_BUILD = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error #(130|418|421|422|423|425)/i;

/** True once per session for errors that smell like a stale build. */
function claimSelfHeal(error: Error & { digest?: string }) {
    if (!STALE_BUILD.test(`${error.name} ${error.message} ${error.digest ?? ''}`)) return false;
    try {
        if (sessionStorage.getItem(RELOAD_FLAG)) return false;
        sessionStorage.setItem(RELOAD_FLAG, '1');
    } catch {
        return false;
    }
    return true;
}

async function dropCachesAndReload() {
    try {
        const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
        await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
        if (typeof caches !== 'undefined') {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
        }
    } catch { /* best effort */ }
    window.location.reload();
}

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const [healing] = useState(() => claimSelfHeal(error));

    useEffect(() => {
        console.error(error);
    }, [error]);

    useEffect(() => {
        if (!healing) return;
        void dropCachesAndReload();
    }, [healing]);

    return (
        <div style={shell}>
            <div style={card}>
                <div style={{ ...glyph, animation: healing ? 'splitx-spin 1s linear infinite' : undefined }}>
                    {healing ? '↻' : '⚠'}
                </div>
                <h1 style={title}>{healing ? 'Updating SplitX…' : 'Something went wrong'}</h1>
                <p style={text}>
                    {healing
                        ? 'A newer version is available. Loading it now.'
                        : 'That screen hit an unexpected error. Try again — your data is safe.'}
                </p>
                {!healing && (
                    <div style={row}>
                        <button type="button" style={primary} onClick={reset}>Try again</button>
                        {/* A full reload on purpose: a crashed or outdated client recovers only by loading afresh. */}
                        {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination */}
                        <button type="button" style={ghost} onClick={() => { window.location.href = '/dashboard'; }}>Go home</button>
                    </div>
                )}
            </div>
            <style>{'@keyframes splitx-spin{to{transform:rotate(360deg)}}'}</style>
        </div>
    );
}

const shell: React.CSSProperties = {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: 'var(--bg-primary, #0a0a0e)',
    color: 'var(--fg-primary, #f4f5f8)',
};

const card: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    maxWidth: 380,
    padding: '32px 24px 26px',
    borderRadius: 28,
    textAlign: 'center',
    background: 'var(--surface-card, #121318)',
    border: '1px solid var(--border-default, rgba(255,255,255,0.08))',
    boxShadow: 'var(--shadow-lg, 0 18px 44px rgba(0,0,0,0.55))',
};

const glyph: React.CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    width: 64,
    height: 64,
    marginBottom: 6,
    borderRadius: 22,
    fontSize: 28,
    background: 'var(--accent-soft, rgba(139,92,246,0.14))',
    color: 'var(--accent-strong, #a78bfa)',
};

const title: React.CSSProperties = { fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' };
const text: React.CSSProperties = { maxWidth: 300, fontSize: 14, lineHeight: 1.55, color: 'var(--fg-tertiary, #9aa0ae)' };
const row: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, width: '100%' };

const buttonBase: React.CSSProperties = {
    flex: 1,
    height: 48,
    borderRadius: 999,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    border: '1px solid transparent',
};

const primary: React.CSSProperties = {
    ...buttonBase,
    background: 'var(--accent-gradient, linear-gradient(135deg,#8b5cf6,#7c3aed))',
    color: 'var(--fg-on-accent, #fff)',
};

const ghost: React.CSSProperties = {
    ...buttonBase,
    background: 'transparent',
    borderColor: 'var(--border-default, rgba(255,255,255,0.08))',
    color: 'var(--fg-primary, #f4f5f8)',
};
