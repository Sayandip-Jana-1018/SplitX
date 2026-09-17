/**
 * The logic behind the /scale demo page, kept out of the component so it can
 * be tested: how a result is read, and how long a phone waits before planning
 * again.
 *
 * Pacing matters because the page is meant to be opened by a whole classroom at
 * once. A fixed interval would have eighty phones fire in lockstep and retry in
 * lockstep after every busy response, so the page would become its own load
 * test. Every wait is therefore jittered, a busy answer (503) backs off
 * exponentially, and a rate-limit answer (429) waits as long as the server said.
 */

export const MIN_MEMBERS = 100;
export const MAX_MEMBERS = 2_000;
export const DEFAULT_MEMBERS = 1_000;

/** About one plan every four seconds per phone while "keep planning" is on. */
const STEADY_MS = 4_000;
const JITTER_MS = 1_000;
const MAX_BACKOFF_FACTOR = 8;

export interface PlanResult {
    people: number;
    expenses: number;
    totalSpentPaise: number;
    payments: number;
    greedyPayments: number;
    directIous: number;
    computeMs: number;
    roundTripMs: number;
    pod: string | null;
    seed: number;
}

export type Outcome =
    | { kind: 'planned'; plan: PlanResult }
    | { kind: 'busy'; retryAfterSeconds: number }
    | { kind: 'limited'; retryAfterSeconds: number }
    | { kind: 'failed'; status: number };

interface PreviewBody {
    data?: {
        scenario?: { members: number; seed: number; expenses: number; totalSpent: number };
        summary?: { transfers: number; greedyTransfers: number; directTransfers?: number };
        computeMs?: number;
        servedBy?: string | null;
    };
}

function retryAfter(header: string | null): number {
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) : 1;
}

/** Reads one response from POST /api/settlements/preview. */
export function readOutcome(status: number, body: unknown, retryAfterHeader: string | null, roundTripMs: number): Outcome {
    if (status === 503) return { kind: 'busy', retryAfterSeconds: retryAfter(retryAfterHeader) };
    if (status === 429) return { kind: 'limited', retryAfterSeconds: retryAfter(retryAfterHeader) };
    const data = (body as PreviewBody | null)?.data;
    if (status !== 200 || !data?.scenario || !data.summary || typeof data.computeMs !== 'number') return { kind: 'failed', status };
    return {
        kind: 'planned',
        plan: {
            people: data.scenario.members,
            expenses: data.scenario.expenses,
            totalSpentPaise: data.scenario.totalSpent,
            payments: data.summary.transfers,
            greedyPayments: data.summary.greedyTransfers,
            directIous: data.summary.directTransfers ?? 0,
            computeMs: data.computeMs,
            roundTripMs: Math.round(roundTripMs),
            pod: data.servedBy ?? null,
            seed: data.scenario.seed,
        },
    };
}

/**
 * How long to wait before the next plan in "keep planning" mode.
 * `streak` counts consecutive busy or failed answers, and is 0 after a success.
 */
export function nextDelayMs(outcome: Outcome | null, streak: number, random: () => number = Math.random): number {
    const jitter = (random() * 2 - 1) * JITTER_MS;
    if (!outcome || outcome.kind === 'planned') return Math.round(STEADY_MS + jitter);
    if (outcome.kind === 'limited') return Math.round(outcome.retryAfterSeconds * 1_000 + Math.abs(jitter));
    const factor = Math.min(2 ** Math.max(0, streak - 1), MAX_BACKOFF_FACTOR);
    const base = outcome.kind === 'busy' ? outcome.retryAfterSeconds * 1_000 : STEADY_MS;
    return Math.round(base * factor + Math.abs(jitter));
}

export function clampMembers(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_MEMBERS;
    return Math.min(MAX_MEMBERS, Math.max(MIN_MEMBERS, Math.round(value / 100) * 100));
}

/** The short, distinguishing end of a pod name: splitx-7d9f8c6b5-x2kqp gives x2kqp. */
export function podLabel(pod: string | null): string {
    if (!pod) return 'SplitX';
    const parts = pod.split('-');
    return parts.length >= 3 ? parts[parts.length - 1] : pod;
}
