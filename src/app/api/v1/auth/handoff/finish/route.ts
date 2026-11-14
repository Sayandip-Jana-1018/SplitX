import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { issueHandoffCode } from '@/lib/authCodes';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { CHALLENGE, finishPath, returnAllowed } from '@/lib/v1/handoff';

const BROKEN = 'This sign-in link isn’t valid. Go back to SplitIT and try again.';

/**
 * GET /api/v1/auth/handoff/finish?challenge=&redirect=: the website has signed
 * someone in; this hands the app a one-time code for that account
 * (src/lib/v1/handoff.ts). Not signed in yet: back to the sign-in page.
 */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const challenge = url.searchParams.get('challenge') ?? '';
    const back = url.searchParams.get('redirect') ?? '';
    if (!CHALLENGE.test(challenge) || !returnAllowed(back)) {
        return new NextResponse(BROKEN, { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(finishPath(challenge, back))}`, request.url));
    }
    try {
        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        if (!user) return NextResponse.redirect(`${back}?error=no_account`);
        const code = await issueHandoffCode(user.id, challenge);
        return NextResponse.redirect(`${back}?code=${encodeURIComponent(code)}`, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
        logger.error('Phone hand-off failed', { err: error });
        return NextResponse.redirect(`${back}?error=server_error`);
    }
}
