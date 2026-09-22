import { consumeAllowance } from '@/lib/rateLimit';

/**
 * Daily allowances for the features that cost money on every call: the AI
 * chat and voice parsing (Gemini) and receipt scanning (OpenAI).
 *
 * Each person has an allowance per feature, and all of SplitX has one ceiling
 * across every feature and person, so a cost can't run away however many
 * accounts ask. `AI_DISABLED=true` switches every AI feature off at once.
 * If the counter can't be reached the feature is unavailable: a paid API is
 * never called unmetered.
 */

export type AiFeature = 'chat' | 'voice' | 'receipt';

const DAY_MS = 24 * 60 * 60 * 1000;

const PER_PERSON_DEFAULT: Record<AiFeature, number> = { chat: 30, voice: 40, receipt: 10 };
const EVERYONE_DEFAULT = 400;

const USES: Record<AiFeature, string> = {
    chat: 'assistant questions',
    voice: 'voice entries',
    receipt: 'receipt scans',
};

function allowance(variable: string, fallback: number) {
    const value = Number(process.env[variable]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

export type AiQuotaResult =
    | { ok: true }
    | { ok: false; status: 429 | 503; error: string; retryAfterSeconds?: number };

const unavailable: AiQuotaResult = {
    ok: false,
    status: 503,
    error: 'AI features are unavailable right now. Please try again later.',
};

/** Takes one use of `feature` for this person, or says why not. */
export async function takeAiQuota(feature: AiFeature, userId: string): Promise<AiQuotaResult> {
    if (process.env.AI_DISABLED === 'true') {
        return { ok: false, status: 503, error: 'AI features are switched off right now.' };
    }

    const perPerson = allowance(`AI_DAILY_${feature.toUpperCase()}_PER_USER`, PER_PERSON_DEFAULT[feature]);
    const mine = await consumeAllowance(`ai:${feature}:${userId}`, perPerson, DAY_MS);
    if (mine.outcome === 'unavailable') return unavailable;
    if (mine.outcome === 'deny') {
        return {
            ok: false,
            status: 429,
            error: `You've used today's ${perPerson} ${USES[feature]}. They come back within a day.`,
            retryAfterSeconds: Math.ceil(mine.resetMs / 1000),
        };
    }

    const everyone = await consumeAllowance('ai:everyone', allowance('AI_DAILY_GLOBAL', EVERYONE_DEFAULT), DAY_MS);
    if (everyone.outcome === 'unavailable') return unavailable;
    if (everyone.outcome === 'deny') {
        return {
            ok: false,
            status: 429,
            error: 'SplitX has reached today’s limit for AI features. Please try again tomorrow.',
            retryAfterSeconds: Math.ceil(everyone.resetMs / 1000),
        };
    }
    return { ok: true };
}
