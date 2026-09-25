import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

const { inviteExpiresAt, inviteIsLive, newInviteCode } = await import('@/lib/groupInvite');

describe('an invite link’s 7 days (D-112)', () => {
    const issuedAt = new Date('2026-09-25T17:00:00.000Z');

    it('ends exactly 7 days after its code was made', () => {
        expect(inviteExpiresAt(issuedAt).toISOString()).toBe('2026-10-02T17:00:00.000Z');
    });

    it('works until the last millisecond, and not at the end', () => {
        expect(inviteIsLive(issuedAt, new Date('2026-10-02T16:59:59.999Z'))).toBe(true);
        expect(inviteIsLive(issuedAt, new Date('2026-10-02T17:00:00.000Z'))).toBe(false);
    });

    it('makes a different code each time, fit for a URL as it is', () => {
        const codes = new Set(Array.from({ length: 100 }, newInviteCode));
        expect(codes.size).toBe(100);
        for (const code of codes) expect(code).toMatch(/^[0-9a-f]{32}$/);
    });
});
