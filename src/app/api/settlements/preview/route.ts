import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { metrics } from '@/lib/metrics';
import { BodyTooLargeError, InvalidJsonError, readJsonBody } from '@/lib/readJsonBody';
import { queuedMs } from '@/lib/requestQueue';
import { planSettlement, type AccountBalance, type PlannedTransfer, type SettlementPlan } from '@/lib/settlementPlanner';
import { MAX_SCENARIO_MEMBERS, MIN_SCENARIO_MEMBERS, simulateTrip } from '@/lib/settlementScenario';

/**
 * POST /api/settlements/preview — the fewest payments that settle a set of balances.
 *
 * Body, one of:
 *   { "balances": [{ "id": "asha", "name": "Asha", "amount": -70000 }, …] }
 *     Whole paise; positive is owed money, negative owes it; must sum to zero.
 *   { "scenario": { "members": 500, "seed": 42 } }
 *     Plans a simulated trip generated from the seed (random when omitted, and
 *     returned so the result can be reproduced).
 *
 * The planner is the one behind every group's settle-up screen. The endpoint
 * needs no database and no sign-in, and its CPU cost grows with group size,
 * which makes it the endpoint the autoscaling demo drives. The proxy rate
 * limits it per identity. A request that has already waited longer than
 * PREVIEW_MAX_QUEUE_MS on a saturated pod is refused with 503, so that pod's
 * backlog — and every request's latency behind it — can't grow without bound.
 */

export const dynamic = 'force-dynamic';

const MAX_BALANCES = 2_000;
/** ₹1 lakh crore. Keeps every sum of up to MAX_BALANCES amounts exact. */
const MAX_AMOUNT_PAISE = 1_000_000_000_000;
const MAX_BODY_BYTES = 256 * 1024;
const SCENARIO_TRANSFERS_SHOWN = 20;
const SERVED_BY = process.env.POD_NAME ?? null;

const BalancesRequest = z.strictObject({
    balances: z
        .array(
            z.strictObject({
                id: z.string().min(1).max(64),
                name: z.string().min(1).max(80).optional(),
                amount: z.int().min(-MAX_AMOUNT_PAISE).max(MAX_AMOUNT_PAISE),
            })
        )
        .min(1)
        .max(MAX_BALANCES),
});

const ScenarioRequest = z.strictObject({
    scenario: z.strictObject({
        members: z.int().min(MIN_SCENARIO_MEMBERS).max(MAX_SCENARIO_MEMBERS),
        seed: z.int().min(0).max(0xffff_ffff).optional(),
    }),
});

type Mode = 'balances' | 'scenario' | 'unknown';

export async function POST(request: Request) {
    try {
        let body: unknown;
        try {
            body = await readJsonBody(request, MAX_BODY_BYTES);
        } catch (error) {
            if (error instanceof BodyTooLargeError) {
                metrics.settlementPreviews.inc({ mode: 'unknown', outcome: 'too_large' });
                return apiError(`Request body must be under ${MAX_BODY_BYTES / 1024} KB`, 413, 'PAYLOAD_TOO_LARGE');
            }
            if (error instanceof InvalidJsonError) return invalid('unknown', error.message);
            throw error;
        }

        const fields = typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {};
        const mode: Mode = 'balances' in fields ? 'balances' : 'scenario' in fields ? 'scenario' : 'unknown';

        // Checked just before the expensive part: this includes time spent
        // queued behind other work in the proxy, routing and body read.
        const waited = queuedMs(request.headers);
        if (waited !== null) {
            metrics.settlementPreviewQueue.observe(waited / 1000);
            if (waited > maxQueueMs()) {
                metrics.settlementPreviews.inc({ mode, outcome: 'shed' });
                const response = apiError('SplitX is busy right now. Please try again in a moment.', 503, 'OVERLOADED');
                response.headers.set('Retry-After', '1');
                return response;
            }
        }

        if ('balances' in fields && 'scenario' in fields) return invalid('unknown', 'Send either balances or a scenario, not both');
        if (mode === 'balances') return previewBalances(body);
        if (mode === 'scenario') return previewScenario(body);
        return invalid('unknown', 'Send balances or a scenario');
    } catch (error) {
        logger.error('Settlement preview failed', { err: error });
        return apiError('Could not preview this settlement', 500);
    }
}

function previewBalances(body: unknown) {
    const parsed = BalancesRequest.safeParse(body);
    if (!parsed.success) return invalid('balances', describeIssue(parsed.error));

    const { balances } = parsed.data;
    if (new Set(balances.map((balance) => balance.id)).size !== balances.length) {
        return invalid('balances', 'Each id can appear only once');
    }
    const total = balances.reduce((sum, balance) => sum + balance.amount, 0);
    if (total !== 0) {
        return invalid('balances', `Balances must sum to zero; these sum to ${total} paise`);
    }

    const started = performance.now();
    const plan = planSettlement(balances);
    const computeMs = recordPlanned('balances', plan, started);

    const names = new Map(balances.map((balance) => [balance.id, balance.name ?? null]));
    return apiSuccess({
        mode: 'balances',
        summary: summarize(balances, plan),
        transfers: plan.transfers.map((transfer) => named(transfer, names)),
        computeMs,
        servedBy: SERVED_BY,
    });
}

function previewScenario(body: unknown) {
    const parsed = ScenarioRequest.safeParse(body);
    if (!parsed.success) return invalid('scenario', describeIssue(parsed.error));

    const { members } = parsed.data.scenario;
    const seed = parsed.data.scenario.seed ?? randomInt(0, 2 ** 32);

    const started = performance.now();
    const trip = simulateTrip(members, seed);
    const plan = planSettlement(trip.balances);
    const computeMs = recordPlanned('scenario', plan, started);

    const names = new Map(trip.members.map((member) => [member.id, member.name]));
    const largest = [...plan.transfers].sort((a, b) => b.amount - a.amount).slice(0, SCENARIO_TRANSFERS_SHOWN);
    return apiSuccess({
        mode: 'scenario',
        scenario: { members, seed, expenses: trip.expenseCount, totalSpent: trip.totalSpent },
        summary: { ...summarize(trip.balances, plan), directTransfers: trip.directTransferCount },
        // A 2,000-person plan is too large to be worth sending; the largest payments are shown.
        transfers: largest.map((transfer) => named(transfer, names)),
        computeMs,
        servedBy: SERVED_BY,
    });
}

function recordPlanned(mode: 'balances' | 'scenario', plan: SettlementPlan, started: number) {
    const elapsedMs = performance.now() - started;
    metrics.settlementPreviewCompute.observe({ mode, algorithm: plan.algorithm }, elapsedMs / 1000);
    metrics.settlementPreviews.inc({ mode, outcome: 'ok' });
    return Math.round(elapsedMs * 100) / 100;
}

function summarize(accounts: readonly AccountBalance[], plan: SettlementPlan) {
    return {
        people: accounts.length,
        unsettled: accounts.filter((account) => account.amount !== 0).length,
        totalOwed: accounts.reduce((sum, account) => sum + Math.max(0, -account.amount), 0),
        transfers: plan.transfers.length,
        greedyTransfers: plan.greedyTransferCount,
        algorithm: plan.algorithm,
        optimal: plan.optimal,
    };
}

function named(transfer: PlannedTransfer, names: Map<string, string | null>) {
    return {
        from: transfer.from,
        fromName: names.get(transfer.from) ?? null,
        to: transfer.to,
        toName: names.get(transfer.to) ?? null,
        amount: transfer.amount,
    };
}

function invalid(mode: Mode, message: string) {
    metrics.settlementPreviews.inc({ mode, outcome: 'invalid' });
    return apiError(message, 400);
}

function describeIssue(error: z.ZodError) {
    const [issue] = error.issues;
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
}

function maxQueueMs() {
    const value = Number(process.env.PREVIEW_MAX_QUEUE_MS);
    return Number.isInteger(value) && value > 0 ? value : 1_000;
}
