import { expect, test } from '@playwright/test';
import { newPerson, newPhone, signIn, signUp } from './support';

/*
 * Flow 1: an account. With no email sender configured, as on production today,
 * an account opens at once (lib/emailVerification.ts): sign up, then in.
 */

test('a new person signs up, signs out, and signs in again', async ({ browser }) => {
    const asha = newPerson('Asha');
    const page = await newPhone(browser);

    await signUp(page, asha);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);

    await signIn(page, asha);
});

test('a wrong password is refused, in words that don\'t say whether the address has an account', async ({ browser }) => {
    const bala = newPerson('Bala');
    const page = await newPhone(browser);
    await signUp(page, bala);
    await page.context().clearCookies();

    const refusal = 'That email and password don’t match. Try again, or reset your password.';
    await page.goto('/login');
    await page.getByLabel('Email').fill(bala.email);
    await page.getByLabel('Password', { exact: true }).fill(bala.password + ' but wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(refusal)).toBeVisible();

    await page.getByLabel('Email').fill(newPerson('Nobody').email);
    await page.getByLabel('Password', { exact: true }).fill(bala.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(refusal)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
});

test('a page that needs an account sends a visitor to sign in, and back again after', async ({ browser }) => {
    const chitra = newPerson('Chitra');
    const page = await newPhone(browser);
    await signUp(page, chitra);
    await page.context().clearCookies();

    await page.goto('/settlements');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fsettlements/);
    await signIn(page, chitra, /\/settlements$/);
});
