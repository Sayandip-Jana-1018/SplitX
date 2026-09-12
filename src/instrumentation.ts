/**
 * Runs once when a Next.js server process starts.
 * https://nextjs.org/docs/app/guides/instrumentation
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    const { startHttpMetrics } = await import('./lib/observability/httpMetrics');
    startHttpMetrics();
}
