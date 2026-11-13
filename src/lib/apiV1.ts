import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { prisma } from '@/lib/db';
import { mobileCaller, type MobileCaller } from '@/lib/mobileAuth';
import { BodyTooLargeError, readJsonBody } from '@/lib/readJsonBody';
import type { Me } from '@/lib/contract/v1';

/**
 * What every phone API route shares: one error shape, `{ error, code }`, a
 * bounded body read checked against the contract (src/lib/contract/v1.ts), and
 * the signed-in caller from the access token.
 */

export function v1Error(error: string, status: number, code: string) {
    return NextResponse.json({ error, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function v1Json<T>(data: T, status = 200) {
    return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

const BODY_LIMIT = 16 * 1024;

/** The request's body, checked against its schema; or the answer that says what was wrong with it. */
export async function readV1Body<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
    let raw: unknown;
    try {
        raw = await readJsonBody(request, BODY_LIMIT);
    } catch (error) {
        return { ok: false, response: error instanceof BodyTooLargeError ? v1Error('That request is too large.', 413, 'too_large') : v1Error('Send JSON.', 400, 'invalid_json') };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const [issue] = parsed.error.issues;
        const field = issue?.path.join('.') || 'request';
        return { ok: false, response: v1Error(`Invalid ${field}: ${issue?.message ?? 'not accepted'}`, 400, 'invalid_input') };
    }
    return { ok: true, data: parsed.data };
}

/** The signed-in caller, or the 401 that tells the app to refresh its token. */
export async function requireCaller(request: Request): Promise<{ ok: true; caller: MobileCaller } | { ok: false; response: NextResponse }> {
    const caller = await mobileCaller(request);
    return caller ? { ok: true, caller } : { ok: false, response: v1Error('Your session has ended. Sign in again.', 401, 'unauthenticated') };
}

/** The account as the app shows it. */
export async function meOf(userId: string): Promise<Me | null> {
    return prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, image: true, upiId: true } });
}
