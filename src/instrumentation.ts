/**
 * Runs once when a Next.js server process starts.
 * https://nextjs.org/docs/app/guides/instrumentation
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    const { startRequestLog } = await import('./lib/observability/requestLog');
    startRequestLog();

    const { warmRateLimiter } = await import('./lib/rateLimit');
    warmRateLimiter();
}
