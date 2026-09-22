import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

// One client, and so one connection pool, per process. It lives on globalThis
// in every environment: in development so hot reloads reuse it, and in
// production because a server can evaluate this module more than once (a
// separate bundle, a separate module graph), and each evaluation would
// otherwise open a pool of its own.
export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });

globalForPrisma.prisma = prisma;
