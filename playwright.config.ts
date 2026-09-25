import { defineConfig, devices } from '@playwright/test';

/**
 * The browser tests of the flows a classroom uses (tests/e2e, D-107): a phone's
 * Chromium against a production build of the app on a real Postgres. CI's e2e
 * job builds the app, migrates a throwaway database and serves it (see
 * .github/workflows/ci.yml); `E2E_BASE_URL` points the tests at it.
 *
 * The flows share one database, so they run one at a time. Each makes its own
 * people, with addresses no other run uses, so a run never depends on another.
 */
export default defineConfig({
    testDir: 'tests/e2e',
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    // A flake is still a failure to look at: the retry's trace is kept for it.
    retries: process.env.CI ? 1 : 0,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list']],
    use: {
        ...devices['Pixel 7'],
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // The app's own clock and the tests' agree on India's time zone and language.
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
    },
});
