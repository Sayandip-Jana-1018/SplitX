/**
 * Google and GitHub sign-in for the phone, through the website's own sign-in
 * page (docs/mobile/ROADMAP.md, Phase 2 step 4):
 *
 *   1. The app opens /api/v1/auth/handoff/start in a secure in-app browser,
 *      with a PKCE challenge (the SHA-256 of a secret only the app holds) and
 *      the address to come back to.
 *   2. Someone not yet signed in on the website goes to its /login page, and
 *      signs in with Google, GitHub or a password, by the website's own rules.
 *   3. /api/v1/auth/handoff/finish makes a one-time code for that account, good
 *      for 2 minutes and only with the app's secret, and returns to the app.
 *   4. The app trades the code and its secret at /api/v1/auth/handoff/exchange
 *      for its own session.
 *
 * Another app claiming the same address could catch the code, but not use it:
 * it doesn't hold the secret.
 */

export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Where the website may send the code: the app itself; while developing, Expo Go too. */
export function returnAllowed(address: string): boolean {
    if (address === 'splitit://auth') return true;
    return process.env.NODE_ENV !== 'production' && /^exp:\/\/[A-Za-z0-9.-]+(:\d{2,5})?\/--\/auth$/.test(address);
}

/** The page that ends the hand-off, carrying what it needs through the sign-in page. */
export function finishPath(challenge: string, back: string) {
    return `/api/v1/auth/handoff/finish?${new URLSearchParams({ challenge, redirect: back }).toString()}`;
}
