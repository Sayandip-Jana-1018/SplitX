import { expect, type Page } from '@playwright/test';
import { memberRow, test, twoInAGroup } from './support';

/*
 * A receipt read on the phone (D-108): the on-device scanner, which needs no AI
 * key, reads a bill with Tesseract (its worker, engine and model served by the
 * app itself), and what it read becomes an expense. It is also the flow that
 * runs WebAssembly and a worker, so it proves the Content Security Policy
 * leaves those working.
 */

/** A bill as a phone would photograph it: large black print on white, drawn in the page. */
async function receiptPhoto(page: Page, lines: string[]): Promise<Buffer> {
    const dataUrl = await page.evaluate((text) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1000;
        canvas.height = 120 + text.length * 80;
        const pen = canvas.getContext('2d');
        if (!pen) throw new Error('no 2D canvas');
        pen.fillStyle = '#ffffff';
        pen.fillRect(0, 0, canvas.width, canvas.height);
        pen.fillStyle = '#000000';
        pen.font = '48px monospace';
        pen.textBaseline = 'top';
        text.forEach((line, index) => pen.fillText(line, 60, 60 + index * 80));
        return canvas.toDataURL('image/png');
    }, lines);
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

test('a receipt read on the phone becomes an expense', async ({ browser }) => {
    const { bala, ashaPhone, group } = await twoInAGroup(browser, 'Cafe run');

    await ashaPhone.goto(`/transactions/scan?groupId=${group.id}`);
    const photo = await receiptPhoto(ashaPhone, [
        'Masala Dosa        180.00',
        'Filter Coffee      120.00',
        'TOTAL              300.00',
        'UPI Ref 412345678901',
        'Paid to Sunrise Cafe',
    ]);
    await ashaPhone.locator('input[type="file"]:not([capture])').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: photo });

    // Read on the device: the amount and the merchant.
    await expect(ashaPhone.getByText('On-device scan')).toBeVisible({ timeout: 60_000 });
    await expect(ashaPhone.getByText('₹300', { exact: true })).toBeVisible();
    await expect(ashaPhone.getByText('Sunrise Cafe', { exact: true })).toBeVisible();

    // The composer opens with both filled in; the photo itself isn't kept (the tests have no storage).
    await ashaPhone.getByRole('button', { name: 'Add as expense' }).click();
    await expect(ashaPhone).toHaveURL(/\/transactions\/new\?/);
    await expect(ashaPhone.getByLabel('Amount in rupees')).toHaveValue('300');
    await expect(ashaPhone.getByLabel('Expense title')).toHaveValue('Sunrise Cafe');
    await ashaPhone.getByRole('button', { name: /^Add ₹300/ }).click();
    await expect(ashaPhone).toHaveURL(/\/transactions$/);
    await expect(ashaPhone.getByRole('button', { name: /Sunrise Cafe/ })).toBeVisible();

    await expect(await memberRow(ashaPhone, group.id, bala.name)).toContainText('−₹150');
});
