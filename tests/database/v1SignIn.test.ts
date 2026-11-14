import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeSession, ErrorBody, MeAnswer, Session, SignUpAnswer } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { emptyDatabase, person } from './fixtures';

// Codes are captured here instead of being emailed.
const mail = vi.hoisted(() => ({ codes: [] as { to: string; code: string; purpose: string }[], notices: [] as string[] }));
vi.mock('@/lib/email', () => ({
    emailTransport: () => 'smtp',
    sendCodeEmail: vi.fn(async (to: string, code: string, purpose: string) => { mail.codes.push({ to, code, purpose }); }),
    sendAlreadyRegisteredEmail: vi.fn(async (to: string) => { mail.notices.push(to); }),
    sendVerificationEmail: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
}));
const session = vi.hoisted(() => ({ current: null as null | { user: { email: string } } }));
vi.mock('next-auth', () => ({
    default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn(async () => session.current) }),
    CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock('next-auth/providers/credentials', () => ({ default: (options: unknown) => options }));
vi.mock('next-auth/providers/google', () => ({ default: (options: unknown) => options }));
vi.mock('next-auth/providers/github', () => ({ default: (options: unknown) => options }));

const codeRoute = await import('@/app/api/v1/auth/email-code/route');
const verifyRoute = await import('@/app/api/v1/auth/email-code/verify/route');
const signUpRoute = await import('@/app/api/v1/auth/sign-up/route');
const resetRoute = await import('@/app/api/v1/auth/password-reset/route');
const passwordRoute = await import('@/app/api/v1/auth/password/route');
const refreshRoute = await import('@/app/api/v1/auth/refresh/route');
const everywhereRoute = await import('@/app/api/v1/auth/sign-out-everywhere/route');
const meRoute = await import('@/app/api/v1/me/route');
const startRoute = await import('@/app/api/v1/auth/handoff/start/route');
const finishRoute = await import('@/app/api/v1/auth/handoff/finish/route');
const exchangeRoute = await import('@/app/api/v1/auth/handoff/exchange/route');
const { EMAIL_CODE_GUESSES } = await import('@/lib/authCodes');

const PHONE = { platform: 'android' as const };
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://splitit.test/api', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const lastCode = (to: string) => [...mail.codes].reverse().find((entry) => entry.to === to)?.code ?? '';

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(async () => {
    await emptyDatabase();
    mail.codes.length = 0;
    mail.notices.length = 0;
    session.current = null;
});
afterAll(() => prisma.$disconnect());

describe('signing in with a code by email', () => {
    it('opens an account for a new address, proven by the code, and asks for a name', async () => {
        expect((await codeRoute.POST(post({ email: 'New.Person@Example.com' }))).status).toBe(202);
        const code = lastCode('new.person@example.com');
        expect(code).toMatch(/^\d{6}$/);

        const answer = await verifyRoute.POST(post({ email: 'new.person@example.com', code, device: PHONE }));
        expect(answer.status).toBe(200);
        const signedIn = CodeSession.parse(await answer.json());
        expect(signedIn).toMatchObject({ isNew: true, me: { email: 'new.person@example.com', name: null } });
        expect((await prisma.user.findUniqueOrThrow({ where: { email: 'new.person@example.com' } })).emailVerified).not.toBeNull();

        // A code works once.
        const again = await verifyRoute.POST(post({ email: 'new.person@example.com', code, device: PHONE }));
        expect(ErrorBody.parse(await again.json()).code).toBe('code_expired');
    });

    it('says a wrong code is wrong, stops after five guesses, and a newer code replaces the old one', async () => {
        const email = 'a@example.com';
        const attempt = async (code: string) => ErrorBody.parse(await (await verifyRoute.POST(post({ email, code, device: PHONE }))).json()).code;
        await codeRoute.POST(post({ email }));
        const first = lastCode(email);
        await codeRoute.POST(post({ email }));
        const second = lastCode(email);
        const wrong = second === '000000' ? '111111' : '000000';

        // The first code was replaced, so it is just a wrong guess now (unless the two happen to match).
        let spent = 0;
        if (first !== second && first !== wrong) {
            expect(await attempt(first)).toBe('wrong_code');
            spent = 1;
        }
        for (let i = spent; i < EMAIL_CODE_GUESSES; i++) {
            expect(await attempt(wrong)).toBe(i === EMAIL_CODE_GUESSES - 1 ? 'too_many_guesses' : 'wrong_code');
        }
        // After five guesses even the right code no longer works.
        expect(await attempt(second)).toBe('too_many_guesses');
    });

    it('removes a password nobody proved they own, as Google sign-in does', async () => {
        const squatter = await prisma.user.create({ data: { name: 'Squatter', email: 'owner@example.com', password: await bcrypt.hash('squatter-password', 4) } });
        await codeRoute.POST(post({ email: 'owner@example.com' }));
        const answer = CodeSession.parse(await (await verifyRoute.POST(post({ email: 'owner@example.com', code: lastCode('owner@example.com'), device: PHONE }))).json());
        expect(answer.me.id).toBe(squatter.id);
        const after = await prisma.user.findUniqueOrThrow({ where: { id: squatter.id } });
        expect(after.password).toBeNull();
        expect(after.emailVerified).not.toBeNull();
    });
});

describe('creating an account', () => {
    it('confirms the address with a code, keeps the chosen password, and signs in', async () => {
        const created = SignUpAnswer.parse(await (await signUpRoute.POST(post({ name: 'Asha', email: 'asha@example.com', password: 'a-good-password', device: PHONE }))).json());
        expect(created).toEqual({ codeSent: true, session: null });
        const code = mail.codes.find((entry) => entry.to === 'asha@example.com' && entry.purpose === 'confirm_sign_up')?.code ?? '';

        const confirmed = CodeSession.parse(await (await verifyRoute.POST(post({ email: 'asha@example.com', code, purpose: 'confirm_sign_up', device: PHONE }))).json());
        expect(confirmed).toMatchObject({ isNew: false, me: { name: 'Asha' } });

        const withPassword = await passwordRoute.POST(post({ email: 'asha@example.com', password: 'a-good-password', device: PHONE }));
        expect(withPassword.status).toBe(200);
    });

    it('answers the same for an address that already has an account, and tells its owner instead', async () => {
        await person('Taken');
        const owner = await prisma.user.findFirstOrThrow();
        const answer = SignUpAnswer.parse(await (await signUpRoute.POST(post({ name: 'Someone', email: owner.email, password: 'another-password', device: PHONE }))).json());
        expect(answer).toEqual({ codeSent: true, session: null });
        expect(mail.codes).toHaveLength(0);
        expect(mail.notices).toEqual([owner.email]);
    });

    it('refuses a short password with the website’s own sentence', async () => {
        const answer = await signUpRoute.POST(post({ name: 'Asha', email: 'asha@example.com', password: 'short', device: PHONE }));
        expect(answer.status).toBe(400);
        expect(ErrorBody.parse(await answer.json())).toMatchObject({ code: 'weak_password', error: 'Use at least 8 characters for your password.' });
    });
});

describe('forgetting a password', () => {
    it('sends a code only to an existing account, answering the same either way', async () => {
        expect((await codeRoute.POST(post({ email: 'nobody@example.com', purpose: 'password_reset' }))).status).toBe(202);
        expect(mail.codes).toHaveLength(0);
    });

    it('sets the new password with the code, ends every other session, and signs this phone in', async () => {
        await prisma.user.create({ data: { name: 'Ravi', email: 'ravi@example.com', password: await bcrypt.hash('old-password', 4), emailVerified: new Date() } });
        const before = Session.parse(await (await passwordRoute.POST(post({ email: 'ravi@example.com', password: 'old-password', device: PHONE }))).json());

        await codeRoute.POST(post({ email: 'ravi@example.com', purpose: 'password_reset' }));
        const reset = await resetRoute.POST(post({ email: 'ravi@example.com', code: lastCode('ravi@example.com'), password: 'new-password-123', device: PHONE }));
        expect(reset.status).toBe(200);
        Session.parse(await reset.json());

        // The old session is over; the new password works and the old one doesn't.
        expect((await refreshRoute.POST(post({ refreshToken: before.tokens.refreshToken }))).status).toBe(401);
        expect((await passwordRoute.POST(post({ email: 'ravi@example.com', password: 'new-password-123', device: PHONE }))).status).toBe(200);
        expect((await passwordRoute.POST(post({ email: 'ravi@example.com', password: 'old-password', device: PHONE }))).status).toBe(401);
    });
});

describe('your account', () => {
    async function signedIn() {
        await codeRoute.POST(post({ email: 'meera@example.com' }));
        return CodeSession.parse(await (await verifyRoute.POST(post({ email: 'meera@example.com', code: lastCode('meera@example.com'), device: PHONE }))).json());
    }

    it('takes a name and a UPI ID, by the website’s rules', async () => {
        const { tokens } = await signedIn();
        const auth = { authorization: `Bearer ${tokens.accessToken}` };
        const patch = (body: object) => meRoute.PATCH(new Request('https://splitit.test/api/v1/me', { method: 'PATCH', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(body) }));
        expect(MeAnswer.parse(await (await patch({ name: 'Meera', upiId: 'meera@okbank' })).json()).me).toMatchObject({ name: 'Meera', upiId: 'meera@okbank' });
        expect((await patch({ upiId: 'not a upi id' })).status).toBe(400);
    });

    it('signs out of every device at once', async () => {
        const { tokens } = await signedIn();
        expect((await everywhereRoute.POST(post({}, { authorization: `Bearer ${tokens.accessToken}` }))).status).toBe(204);
        expect((await refreshRoute.POST(post({ refreshToken: tokens.refreshToken }))).status).toBe(401);
    });
});

describe('Google and GitHub, through the website', () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const get = (route: { GET: (request: Request) => Promise<Response> }, path: string) => route.GET(new Request(`https://splitit.test${path}`));
    const query = (back = 'splitit://auth') => `?${new URLSearchParams({ challenge, redirect: back })}`;

    it('sends someone not signed in to the website’s sign-in page, and comes back to finish', async () => {
        const answer = await get(startRoute, `/api/v1/auth/handoff/start${query()}`);
        expect(answer.status).toBe(307);
        const location = new URL(answer.headers.get('location')!);
        expect(location.pathname).toBe('/login');
        expect(location.searchParams.get('callbackUrl')).toMatch(/^\/api\/v1\/auth\/handoff\/finish\?/);
    });

    it('hands the app a one-time code that only its verifier can redeem', async () => {
        const meera = await person('Meera');
        session.current = { user: { email: meera.email! } };
        const finish = await get(finishRoute, `/api/v1/auth/handoff/finish${query()}`);
        const back = new URL(finish.headers.get('location')!);
        expect(back.protocol).toBe('splitit:');
        const code = back.searchParams.get('code')!;

        const stolen = await exchangeRoute.POST(post({ code, verifier: randomBytes(32).toString('base64url'), device: PHONE }));
        expect(ErrorBody.parse(await stolen.json()).code).toBe('handoff_expired');

        const traded = Session.parse(await (await exchangeRoute.POST(post({ code, verifier, device: PHONE }))).json());
        expect(traded.me.id).toBe(meera.id);
        // Once only.
        expect((await exchangeRoute.POST(post({ code, verifier, device: PHONE }))).status).toBe(401);
    });

    it('never sends the code anywhere but the app', async () => {
        for (const back of ['https://evil.example/auth', 'splitit://elsewhere', 'javascript:alert(1)']) {
            expect((await get(startRoute, `/api/v1/auth/handoff/start${query(back)}`)).status).toBe(400);
        }
    });
});
