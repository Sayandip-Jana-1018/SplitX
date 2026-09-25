import { test as base, expect, type Browser, type Page } from '@playwright/test';

/*
 * What every flow does the way a person does it (D-107): opening the app on a
 * phone, signing up, signing in, making a group and adding an expense. Only
 * the page is used, never the API behind it, so a broken screen fails here.
 */

/** What the Content Security Policy refused, or would have, on any of the test's phones (D-108). */
const cspViolations: string[] = [];

/**
 * The flows' `test`: each also fails if the browser reported a Content Security
 * Policy violation on any page it opened. That is what proves the enforced
 * policy blocks nothing the app itself needs (D-108).
 */
export const test = base.extend<{ contentSecurityPolicy: void }>({
    contentSecurityPolicy: [async ({ browserName }, use) => {
        expect(browserName).toBe('chromium');
        cspViolations.length = 0;
        await use();
        expect(cspViolations, 'what the Content Security Policy refused').toEqual([]);
    }, { auto: true }],
});

export interface Person {
    name: string;
    email: string;
    password: string;
}

const RUN = Date.now().toString(36);
let made = 0;

/**
 * Someone new for this run. The address is unique to the run, on the `.test`
 * domain, which never receives mail, and the database is the run's own.
 */
export function newPerson(first: string): Person {
    made += 1;
    return {
        name: `${first} E2E`,
        email: `e2e-${first.toLowerCase()}-${RUN}-${made}@splitx.test`,
        password: `correct horse ${RUN} ${made}`,
    };
}

/**
 * A phone of its own: separate cookies and storage, so two people can use the
 * app side by side. The guided tour a first visit shows is marked as seen, as
 * it would be after its first dismissal.
 */
export async function newPhone(browser: Browser): Promise<Page> {
    const context = await browser.newContext();
    await context.addInitScript(() => {
        try {
            globalThis.localStorage.setItem('SplitX-tour-v2', 'true');
        } catch {
            // Storage blocked: the tour shows, and the flows dismiss nothing.
        }
        // The browser's own record of each refusal, said where the test can hear it.
        document.addEventListener('securitypolicyviolation', (event) => {
            console.error(`CSP violation (${event.disposition}): ${event.effectiveDirective} refused ${event.blockedURI || 'inline'} on ${location.pathname}`);
        });
    });
    context.on('console', (message) => {
        if (message.text().startsWith('CSP violation (')) cspViolations.push(message.text());
    });
    return context.newPage();
}

/** Signs up through /register and waits for the dashboard, signed in. */
export async function signUp(page: Page, person: Person) {
    await page.goto('/register');
    await page.getByLabel('Full name').fill(person.name);
    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password', { exact: true }).fill(person.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Signs in through /login, and waits for where it leads. With `lands` given,
 * the page is already the sign-in form a redirect opened, callbackUrl and all.
 */
export async function signIn(page: Page, person: Person, lands?: RegExp) {
    if (!lands) await page.goto('/login');
    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password', { exact: true }).fill(person.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(lands ?? /\/dashboard$/);
}

export interface Group {
    id: string;
    inviteLink: string;
}

/** Makes a group from /groups, keeps its invite link, and opens it. */
export async function createGroup(page: Page, name: string): Promise<Group> {
    await page.goto('/groups');
    await page.getByRole('button', { name: 'New group' }).click();
    await page.getByLabel('Group name').fill(name);
    await page.getByRole('button', { name: 'Create group' }).click();
    await expect(page.getByText(`${name} is ready`)).toBeVisible();
    const inviteLink = (await page.getByText(/\/join\/[\w-]+$/).first().textContent())?.trim() ?? '';
    expect(inviteLink).toMatch(/\/join\/[\w-]+$/);
    await page.getByRole('button', { name: 'Open group' }).click();
    await expect(page).toHaveURL(/\/groups\/[\w-]+$/);
    return { id: new URL(page.url()).pathname.split('/').pop() ?? '', inviteLink };
}

/** Opens someone's invite link and joins the group, then waits for its page. */
export async function joinGroup(page: Page, group: Group) {
    await page.goto(new URL(group.inviteLink).pathname);
    await page.getByRole('button', { name: 'Join group' }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group.id}$`));
}

/**
 * Two people in one group, each on a phone: the first made it and paid what
 * follows; the second joined from its link.
 */
export async function twoInAGroup(browser: Browser, groupName: string) {
    const asha = newPerson('Asha');
    const bala = newPerson('Bala');
    const ashaPhone = await newPhone(browser);
    const balaPhone = await newPhone(browser);
    await signUp(ashaPhone, asha);
    await signUp(balaPhone, bala);
    const group = await createGroup(ashaPhone, groupName);
    await joinGroup(balaPhone, group);
    return { asha, bala, ashaPhone, balaPhone, group };
}

/**
 * One person's row in a group's member list, which shows what they owe or get
 * back ("−₹450 owes"). The signed-in person's own row carries "(you)".
 */
export async function memberRow(page: Page, groupId: string, name: string) {
    await page.goto(`/groups/${groupId}`);
    await page.getByRole('tab', { name: 'Members' }).click();
    const title = page.getByText(new RegExp(`^${name}( \\(you\\))?$`));
    return page.locator('div').filter({ has: title }).filter({ hasText: /owes|gets back|settled/ }).last();
}

/**
 * Adds an expense from the composer, paid by whoever is signed in. `custom`
 * gives each named person's share in rupees, and `remainder` what the composer
 * must then work out for the last person, whose share it fills in itself.
 * Without `custom` the split is equal.
 */
export async function addExpense(
    page: Page,
    groupId: string,
    expense: { title: string; rupees: number; custom?: Record<string, number>; remainder?: Record<string, number> },
) {
    await page.goto(`/transactions/new?groupId=${groupId}`);
    await page.getByLabel('Amount in rupees').fill(String(expense.rupees));
    await page.getByLabel('Expense title').fill(expense.title);
    if (expense.custom) {
        await page.getByRole('tab', { name: 'Custom' }).click();
        for (const [name, rupees] of Object.entries(expense.custom)) {
            await page.getByLabel(`Amount for ${name}`).fill(String(rupees));
        }
        for (const [name, rupees] of Object.entries(expense.remainder ?? {})) {
            await expect(page.getByLabel(`Amount for ${name}`)).toHaveValue(rupees.toFixed(2));
        }
    }
    await page.getByRole('button', { name: /^Add ₹/ }).click();
    await expect(page).toHaveURL(/\/transactions$/);
}
