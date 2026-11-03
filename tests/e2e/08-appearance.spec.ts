import { expect } from '@playwright/test';
import { newPerson, newPhone, signUp, test } from './support';

/*
 * Settings' Appearance section (docs/web/LIQUID_GLASS_OVERHAUL.md, Phase 5): every
 * choice applies at once, across the page, and is already there on the next load,
 * before anything has had the chance to paint the old one.
 */
test('the kind of glass, colour, mode and motion apply at once and survive a reload', async ({ browser }) => {
    const page = await newPhone(browser);
    await signUp(page, newPerson('Asha'));
    await page.goto('/settings');
    const html = page.locator('html');

    await page.getByRole('radio', { name: /Frosted/ }).click();
    await expect(html).toHaveAttribute('data-glass-style', 'frosted');

    await page.getByRole('radio', { name: 'Emerald' }).click();
    await expect(html).toHaveAttribute('data-palette', 'emerald-glow');

    await page.getByRole('tab', { name: 'Light', exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    await page.getByRole('switch', { name: 'Calm motion' }).click();
    await expect(html).toHaveAttribute('data-motion', 'calm');

    // Read before the app's own code runs: this is what the first paint will use.
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
            const root = document.documentElement;
            (window as unknown as { firstPaint: unknown }).firstPaint = {
                glass: root.getAttribute('data-glass-style'),
                palette: root.getAttribute('data-palette'),
                theme: root.getAttribute('data-theme'),
                motion: root.getAttribute('data-motion'),
            };
        });
    });
    await page.reload();
    const firstPaint = await page.evaluate(() => (window as unknown as { firstPaint: unknown }).firstPaint);
    expect(firstPaint).toEqual({ glass: 'frosted', palette: 'emerald-glow', theme: 'light', motion: 'calm' });
});
