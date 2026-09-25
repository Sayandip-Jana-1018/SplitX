import { expect, test } from '@playwright/test';
import { addExpense, memberRow, twoInAGroup } from './support';

/*
 * Flow 3: expenses, split equally and by chosen amounts, and what each leaves
 * everyone owing. Flow 4: an expense changed, then one removed.
 */

test('an equal and a custom expense leave each person owing what they should', async ({ browser }) => {
    const { asha, bala, ashaPhone, balaPhone, group } = await twoInAGroup(browser, 'Flat 4B');

    // ₹900 between two: Bala owes ₹450.
    await addExpense(ashaPhone, group.id, { title: 'Dinner', rupees: 900 });
    await expect(ashaPhone.getByRole('button', { name: /Dinner/ })).toBeVisible();

    // ₹300 by amounts: Asha's ₹100, and the last person gets the remainder, ₹200.
    await addExpense(ashaPhone, group.id, { title: 'Snacks', rupees: 300, custom: { [asha.name]: 100 }, remainder: { [bala.name]: 200 } });
    await expect(ashaPhone.getByRole('button', { name: /Snacks/ })).toBeVisible();

    // Bala owes ₹650 in all, on both phones.
    const balaOnAsha = await memberRow(ashaPhone, group.id, bala.name);
    await expect(balaOnAsha).toContainText('−₹650');
    await expect(balaOnAsha).toContainText('owes');
    const ashaOnBala = await memberRow(balaPhone, group.id, asha.name);
    await expect(ashaOnBala).toContainText('+₹650');
    await expect(ashaOnBala).toContainText('gets back');
});

test('a custom split that comes to more than the amount can\'t be saved', async ({ browser }) => {
    const { asha, ashaPhone, group } = await twoInAGroup(browser, 'Road trip');

    await ashaPhone.goto(`/transactions/new?groupId=${group.id}`);
    await ashaPhone.getByLabel('Amount in rupees').fill('300');
    await ashaPhone.getByLabel('Expense title').fill('Fuel');
    await ashaPhone.getByRole('tab', { name: 'Custom' }).click();
    await ashaPhone.getByLabel(`Amount for ${asha.name}`).fill('350');
    await expect(ashaPhone.getByRole('button', { name: /^Add ₹/ })).toBeDisabled();
});

test('an expense is changed, and another removed, and the balances follow', async ({ browser }) => {
    const { bala, ashaPhone, group } = await twoInAGroup(browser, 'Weekend');
    await addExpense(ashaPhone, group.id, { title: 'Dinner', rupees: 900 });
    await addExpense(ashaPhone, group.id, { title: 'Snacks', rupees: 200 });
    await expect(await memberRow(ashaPhone, group.id, bala.name)).toContainText('−₹550');

    // Dinner becomes ₹1,000, as "Team dinner".
    await ashaPhone.goto('/transactions');
    await ashaPhone.getByRole('button', { name: /Dinner/ }).click();
    await ashaPhone.getByRole('button', { name: 'Edit' }).click();
    await ashaPhone.getByLabel('Title').fill('Team dinner');
    await ashaPhone.getByLabel('Amount (₹)').fill('1000');
    await ashaPhone.getByRole('button', { name: 'Save changes' }).click();
    await expect(ashaPhone.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await ashaPhone.keyboard.press('Escape');
    await expect(ashaPhone.getByRole('button', { name: /Team dinner/ })).toBeVisible();

    // Snacks goes.
    await ashaPhone.getByRole('button', { name: /Snacks/ }).click();
    await ashaPhone.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(ashaPhone.getByText('Delete “Snacks”?')).toBeVisible();
    await ashaPhone.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(ashaPhone.getByRole('button', { name: /Snacks/ })).toHaveCount(0);

    await expect(await memberRow(ashaPhone, group.id, bala.name)).toContainText('−₹500');
});
