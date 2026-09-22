import { afterEach, describe, expect, it, vi } from 'vitest';

// A production server can evaluate src/lib/db.ts more than once (a separate
// bundle, a separate module graph), and every PrismaClient opens its own
// connection pool. The client lives on globalThis so that a second evaluation
// finds the first client instead of opening a second pool.
describe('the Prisma client', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        delete (globalThis as { prisma?: unknown }).prisma;
    });

    it('is one client per process, in production too, however many times the module is loaded', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/unused');

        vi.resetModules();
        const first = (await import('@/lib/db')).prisma;
        vi.resetModules();
        const second = (await import('@/lib/db')).prisma;

        // Compared by identity: a failing toBe would try to print two clients.
        expect(second === first).toBe(true);
        await first.$disconnect();
    });
});
