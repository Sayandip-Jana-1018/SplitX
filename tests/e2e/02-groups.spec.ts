import { expect } from '@playwright/test';
import { createGroup, joinGroup, newPerson, newPhone, signUp, test } from './support';

/*
 * Flow 2: a group. One person makes it and shares its link; a friend opens the
 * link on their own phone and joins; each then sees the other in it.
 */

test('a group is made, its link shared, and a friend joins from it', async ({ browser }) => {
    const asha = newPerson('Asha');
    const bala = newPerson('Bala');
    const ashaPhone = await newPhone(browser);
    const balaPhone = await newPhone(browser);
    await signUp(ashaPhone, asha);
    await signUp(balaPhone, bala);

    const group = await createGroup(ashaPhone, 'Goa trip');
    await joinGroup(balaPhone, group);

    await balaPhone.getByRole('tab', { name: 'Members' }).click();
    await expect(balaPhone.getByText(asha.name, { exact: true })).toBeVisible();
    await expect(balaPhone.getByText(`${bala.name} (you)`)).toBeVisible();

    await ashaPhone.reload();
    await ashaPhone.getByRole('tab', { name: 'Members' }).click();
    await expect(ashaPhone.getByText(bala.name, { exact: true })).toBeVisible();
});

test('a link to a group that doesn\'t exist says so', async ({ browser }) => {
    const chitra = newPerson('Chitra');
    const page = await newPhone(browser);
    await signUp(page, chitra);

    await page.goto('/join/not-a-real-code');
    await expect(page.getByText('This invite has expired')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join group' })).toHaveCount(0);
});
