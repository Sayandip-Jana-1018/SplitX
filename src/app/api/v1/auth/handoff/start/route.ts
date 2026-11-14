import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { CHALLENGE, finishPath, returnAllowed } from '@/lib/v1/handoff';

const BROKEN = 'This sign-in link isn’t valid. Go back to SplitIT and try again.';

/**
 * GET /api/v1/auth/handoff/start?challenge=&redirect=: the app's in-app browser
 * starts here. Already signed in on the website: straight on. Otherwise: the
 * website's sign-in page, which comes back to finish (src/lib/v1/handoff.ts).
 */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const challenge = url.searchParams.get('challenge') ?? '';
    const back = url.searchParams.get('redirect') ?? '';
    if (!CHALLENGE.test(challenge) || !returnAllowed(back)) {
        return new NextResponse(BROKEN, { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const finish = finishPath(challenge, back);
    const session = await auth();
    const target = session?.user?.email ? finish : `/login?callbackUrl=${encodeURIComponent(finish)}`;
    return NextResponse.redirect(new URL(target, request.url), { headers: { 'cache-control': 'no-store' } });
}
