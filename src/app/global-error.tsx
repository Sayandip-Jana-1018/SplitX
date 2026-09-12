'use client';

import { useEffect } from 'react';

/** Last-resort boundary: the root layout itself failed, so we render our own document. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => { console.error(error); }, [error]);

    return (
        <html lang="en">
            <body style={{ margin: 0, background: '#0a0a0e', color: '#f4f5f8', fontFamily: 'system-ui, sans-serif' }}>
                <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                    <div style={{ maxWidth: 360, textAlign: 'center' }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠</div>
                        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>SplitX couldn’t start</h1>
                        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#9aa0ae', marginBottom: 20 }}>
                            Reload the page to try again.
                        </p>
                        <button
                            type="button"
                            onClick={reset}
                            style={{
                                height: 48, padding: '0 26px', borderRadius: 999, border: 'none', cursor: 'pointer',
                                background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', color: '#fff', fontSize: 15, fontWeight: 700,
                            }}
                        >
                            Reload
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
