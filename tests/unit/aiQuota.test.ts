import { afterEach, describe, expect, it, vi } from 'vitest';

const { consumeAllowance } = vi.hoisted(() => ({ consumeAllowance: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({ consumeAllowance }));

const { takeAiQuota } = await import('@/lib/aiQuota');

const DAY_MS = 24 * 60 * 60 * 1000;
const allow = { outcome: 'allow', resetMs: 1_000 };

afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
});

describe('takeAiQuota', () => {
    it("counts one use against the person's daily allowance and SplitX's", async () => {
        consumeAllowance.mockResolvedValue(allow);

        expect(await takeAiQuota('chat', 'user-1')).toEqual({ ok: true });
        expect(consumeAllowance.mock.calls).toEqual([
            ['ai:chat:user-1', 30, DAY_MS],
            ['ai:everyone', 400, DAY_MS],
        ]);
    });

    it('stops a person at their allowance, and says when it comes back', async () => {
        consumeAllowance.mockResolvedValueOnce({ outcome: 'deny', resetMs: 7_200_500 });

        expect(await takeAiQuota('receipt', 'user-1')).toEqual({
            ok: false,
            status: 429,
            error: "You've used today's 10 receipt scans. They come back within a day.",
            retryAfterSeconds: 7_201,
        });
        expect(consumeAllowance).toHaveBeenCalledTimes(1);
    });

    it('stops everyone at the shared ceiling', async () => {
        consumeAllowance.mockResolvedValueOnce(allow).mockResolvedValueOnce({ outcome: 'deny', resetMs: 60_000 });

        const result = await takeAiQuota('voice', 'user-1');

        expect(result).toMatchObject({ ok: false, status: 429, error: 'SplitX has reached today’s limit for AI features. Please try again tomorrow.' });
    });

    it('refuses rather than calling a paid API unmetered when the counter is unreachable', async () => {
        consumeAllowance.mockResolvedValue({ outcome: 'unavailable' });

        expect(await takeAiQuota('chat', 'user-1')).toMatchObject({ ok: false, status: 503 });
    });

    it('switches every AI feature off with AI_DISABLED, without counting', async () => {
        vi.stubEnv('AI_DISABLED', 'true');

        expect(await takeAiQuota('chat', 'user-1')).toEqual({ ok: false, status: 503, error: 'AI features are switched off right now.' });
        expect(consumeAllowance).not.toHaveBeenCalled();
    });

    it('takes its allowances from the environment when set', async () => {
        vi.stubEnv('AI_DAILY_CHAT_PER_USER', '5');
        vi.stubEnv('AI_DAILY_GLOBAL', '50');
        consumeAllowance.mockResolvedValue(allow);

        await takeAiQuota('chat', 'user-1');

        expect(consumeAllowance.mock.calls.map((call) => call[1])).toEqual([5, 50]);
    });
});
