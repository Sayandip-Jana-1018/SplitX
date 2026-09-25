import { expect, test } from '@playwright/test';
import { createGroup, newPerson, newPhone, signUp } from './support';

/*
 * Flow 7: a shared phone. After signing out, nothing of the account is left in
 * the browser: no session, and nothing in its caches but the offline page
 * (lib/signOut.ts, public/sw.js). A worker from an older build may have left
 * copies of pages and API answers; signing out removes those too.
 */

test('signing out leaves no session, and no copy of the account in the browser\'s caches', async ({ browser }) => {
    const asha = newPerson('Asha');
    const page = await newPhone(browser);
    await signUp(page, asha);
    const group = await createGroup(page, 'Shared phone');

    // The production build installs its service worker, which keeps only the offline page.
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? 'none'), { timeout: 30_000 })
        .toBe('activated');

    // As an older worker might have: a copy of the account's answer, and of a page.
    await page.evaluate(async () => {
        const stale = await caches.open('splitx-api-v0');
        await stale.put('/api/me', new Response('{"email":"kept by an old worker"}', { headers: { 'content-type': 'application/json' } }));
        await stale.put('/dashboard', new Response('<p>kept by an old worker</p>', { headers: { 'content-type': 'text/html' } }));
    });

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);

    const left = await page.evaluate(async () => {
        const names = await caches.keys();
        const entries = await Promise.all(names.map(async (name) => ({ name, urls: (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname) })));
        return entries;
    });
    expect(left.map((cache) => cache.name)).toEqual(['splitx-offline-v1']);
    expect(left[0].urls).toEqual(['/offline.html']);

    // No session: the account's pages send the next person to sign in.
    for (const path of ['/dashboard', `/groups/${group.id}`, '/settlements']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    }
    const cookies = await page.context().cookies();
    expect(cookies.filter((cookie) => /authjs\.session-token/.test(cookie.name))).toEqual([]);
});
