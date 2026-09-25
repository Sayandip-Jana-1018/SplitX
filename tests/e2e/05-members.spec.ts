import { expect, type Page, test } from '@playwright/test';
import { addExpense, memberRow, twoInAGroup } from './support';

/*
 * Flow 6: removing a member. Refused while they owe anything (D-063: splits are
 * never rewritten), allowed once they're settled, and their old invite link
 * stops working, so they can't walk back in with it.
 */

async function removeFromGroup(page: Page, groupId: string, name: string) {
    await page.goto(`/groups/${groupId}`);
    await page.getByRole('tab', { name: 'Members' }).click();
    await page.getByRole('button', { name: `Remove ${name}` }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
}

test('someone who owes can\'t be removed; once settled they can, and their old link no longer works', async ({ browser }) => {
    const { bala, ashaPhone, balaPhone, group } = await twoInAGroup(browser, 'Office lunch');
    await addExpense(ashaPhone, group.id, { title: 'Biryani', rupees: 600 });

    await removeFromGroup(ashaPhone, group.id, bala.name);
    await expect(ashaPhone.getByText(/still owes .* in this group\. Settle up first, then remove them\./)).toBeVisible();
    await ashaPhone.keyboard.press('Escape');
    await expect(await memberRow(ashaPhone, group.id, bala.name)).toContainText('−₹300');

    // Bala pays ₹300 in cash; Asha confirms receiving it.
    await balaPhone.goto('/settlements');
    await balaPhone.getByRole('button', { name: 'Paid cash' }).click();
    await balaPhone.getByRole('button', { name: 'Yes, I paid' }).click();
    await expect(balaPhone.getByText('Awaiting approval')).toBeVisible();
    await ashaPhone.goto('/settlements');
    await ashaPhone.getByRole('button', { name: 'Approve' }).click();
    await expect(ashaPhone.getByText('Needs your approval')).toHaveCount(0);

    await removeFromGroup(ashaPhone, group.id, bala.name);
    await expect(ashaPhone.getByText(/was removed from the group/)).toBeVisible();
    await expect(ashaPhone.getByText(bala.name, { exact: true })).toHaveCount(0);

    // The link Bala joined with was replaced when Bala was removed.
    await balaPhone.goto(new URL(group.inviteLink).pathname);
    await expect(balaPhone.getByText('This invite has expired')).toBeVisible();
});
