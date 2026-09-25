import { expect, type Page } from '@playwright/test';
import { addExpense, memberRow, test, twoInAGroup } from './support';

/*
 * Flow 5: settling up, through each state a payment passes (D-066's table in
 * lib/settlementTransitions.ts): the payer says they paid, the receiver sends
 * it back as not received, the payer says so again, and the receiver approves.
 * Only then is the balance cleared.
 */

/** The settle-up page, on one group. */
async function settleUp(page: Page, groupName: string) {
    await page.goto('/settlements');
    const chip = page.getByRole('button', { name: new RegExp(groupName) });
    if (await chip.count()) await chip.first().click();
}

test('a payment goes from paid, to sent back, to paid again, to approved, and only then clears the balance', async ({ browser }) => {
    const { asha, bala, ashaPhone, balaPhone, group } = await twoInAGroup(browser, 'Hostel');
    await addExpense(ashaPhone, group.id, { title: 'Groceries', rupees: 900 });
    const ashaFirst = asha.name.split(' ')[0];
    const balaFirst = bala.name.split(' ')[0];

    // Bala says they paid ₹450 in cash.
    await settleUp(balaPhone, 'Hostel');
    await expect(balaPhone.getByText(`You pay ${ashaFirst}`)).toBeVisible();
    await balaPhone.getByRole('button', { name: 'Paid cash' }).click();
    await balaPhone.getByRole('button', { name: 'Yes, I paid' }).click();
    await expect(balaPhone.getByText('Awaiting approval')).toBeVisible();

    // Asha hasn't seen it: back to Bala. The balance hasn't moved.
    await settleUp(ashaPhone, 'Hostel');
    await expect(ashaPhone.getByText(`${balaFirst} pays you`)).toBeVisible();
    await expect(ashaPhone.getByText('Needs your approval')).toBeVisible();
    await ashaPhone.getByRole('button', { name: 'Not received' }).click();
    await expect(ashaPhone.getByText('Needs your approval')).toHaveCount(0);
    await expect(await memberRow(ashaPhone, group.id, bala.name)).toContainText('−₹450');

    // Bala says so again; this time Asha approves.
    await settleUp(balaPhone, 'Hostel');
    await expect(balaPhone.getByText('Finish paying')).toBeVisible();
    await balaPhone.getByRole('button', { name: 'Paid cash' }).click();
    await balaPhone.getByRole('button', { name: 'Yes, I paid' }).click();
    await expect(balaPhone.getByText('Awaiting approval')).toBeVisible();

    await settleUp(ashaPhone, 'Hostel');
    await ashaPhone.getByRole('button', { name: 'Approve' }).click();
    await expect(ashaPhone.getByText('Needs your approval')).toHaveCount(0);

    const settled = await memberRow(ashaPhone, group.id, bala.name);
    await expect(settled).toContainText('settled');
    await expect(settled).toContainText('₹0');
});
