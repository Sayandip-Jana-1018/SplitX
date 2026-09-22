import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { emptyDatabase, person, sessionOf } from './fixtures';

// next-auth itself needs Next's server runtime; the session check it calls
// (sessionToken) and the route that ends sessions don't.
vi.mock('next-auth', () => ({
    default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }),
    CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock('next-auth/providers/credentials', () => ({ default: (options: unknown) => options }));
vi.mock('next-auth/providers/google', () => ({ default: (options: unknown) => options }));
vi.mock('next-auth/providers/github', () => ({ default: (options: unknown) => options }));

const { auth, sessionToken } = await import('@/lib/auth');
const sessions = await import('@/app/api/me/sessions/route');

beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

describe('signing out of all devices', () => {
    it('ends a session issued before it, on the real column, and lets a new sign-in work', async () => {
        const alice = await person('Alice');
        const signIn = () => sessionToken({ token: {}, user: { id: alice.id, email: alice.email } });

        const phone = await signIn();
        expect(phone).toMatchObject({ id: alice.id, tokenVersion: 0 });
        expect(await sessionToken({ token: { ...phone } })).not.toBeNull();

        vi.mocked(auth).mockResolvedValue(sessionOf(alice) as never);
        expect((await sessions.DELETE()).status).toBe(200);

        expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).tokenVersion).toBe(1);
        expect(await sessionToken({ token: { ...phone } })).toBeNull();

        const laptop = await signIn();
        expect(laptop).toMatchObject({ tokenVersion: 1 });
        expect(await sessionToken({ token: { ...laptop } })).not.toBeNull();
    });
});
