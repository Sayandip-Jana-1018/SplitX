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

test('the owner makes a new link: it lets a friend in, and the one shared before doesn\'t', async ({ browser }) => {
    const asha = newPerson('Asha');
    const bala = newPerson('Bala');
    const ashaPhone = await newPhone(browser);
    const balaPhone = await newPhone(browser);
    await signUp(ashaPhone, asha);
    await signUp(balaPhone, bala);

    const group = await createGroup(ashaPhone, 'Hampi trip');
    await ashaPhone.getByRole('button', { name: 'Invite people' }).first().click();
    // A link works for 7 days (D-112), and the sheet says until when.
    await expect(ashaPhone.getByText(/^Works until /)).toBeVisible();
    await ashaPhone.getByRole('button', { name: 'New link' }).click();
    await expect(ashaPhone.getByText('New link ready. The old one no longer works.')).toBeVisible();
    const inviteLink = (await ashaPhone.getByText(/\/join\/[\w-]+$/).first().textContent())?.trim() ?? '';
    expect(inviteLink).toMatch(/\/join\/[0-9a-f]{32}$/);
    expect(inviteLink).not.toBe(group.inviteLink);

    await balaPhone.goto(new URL(group.inviteLink).pathname);
    await expect(balaPhone.getByText('This invite has expired')).toBeVisible();
    await joinGroup(balaPhone, { ...group, inviteLink });
});
