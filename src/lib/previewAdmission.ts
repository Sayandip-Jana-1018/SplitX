/**
 * How many settlement previews one process accepts at a time.
 *
 * Queue-time shedding asks how long a request has already waited. Measured on
 * the cluster, that is not enough on its own: when a busy event loop briefly
 * catches up, a burst of requests all pass the one-second check together, each
 * then holds the CPU for tens of milliseconds, and the loop stalls for seconds.
 * Refused requests waited 10.7 s at p95 inside the pod to be told so, and
 * liveness checks waited behind them. The waiting is decided by the work already
 * accepted, so the limit has to be on that.
 *
 * The proxy admits a preview only while fewer than PREVIEW_MAX_IN_FLIGHT are
 * admitted and unfinished in this process, and refuses the rest at once. The
 * route releases the admission when it finishes, however it finishes. Planning
 * is CPU bound on one thread, so the cap bounds the backlog directly: eight
 * 2,000-person plans are under half a second of work.
 *
 * Admissions live on globalThis because the proxy and the route handler are
 * separate bundles in one process. An admission a route never releases (the
 * process was shutting down, say) expires after a minute rather than holding a
 * slot forever.
 */

export const PREVIEW_ADMISSION_HEADER = 'x-splitx-preview-admission';
const STALE_AFTER_MS = 60_000;

const state = globalThis as typeof globalThis & { __splitxPreviewAdmissions?: Map<string, number> };

function admissions(): Map<string, number> {
    state.__splitxPreviewAdmissions ??= new Map();
    return state.__splitxPreviewAdmissions;
}

export function previewMaxInFlight(): number {
    const value = Number(process.env.PREVIEW_MAX_IN_FLIGHT);
    return Number.isInteger(value) && value > 0 ? value : 8;
}

/** Admits one preview under `id`, or returns false when the process is already full. */
export function tryAdmitPreview(id: string, now = Date.now()): boolean {
    const admitted = admissions();
    if (admitted.size >= previewMaxInFlight()) {
        for (const [key, at] of admitted) if (now - at > STALE_AFTER_MS) admitted.delete(key);
        if (admitted.size >= previewMaxInFlight()) return false;
    }
    admitted.set(id, now);
    return true;
}

export function releasePreview(id: string | null | undefined): void {
    if (id) admissions().delete(id);
}

export function previewsInFlight(): number {
    return admissions().size;
}

/** Test hook. */
export function resetPreviewAdmissions(): void {
    admissions().clear();
}
