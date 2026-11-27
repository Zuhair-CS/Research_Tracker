import { expect, type Page } from '@playwright/test';
import { ACCOUNTS } from './env';

export async function login(page: Page, who: keyof typeof ACCOUNTS): Promise<void> {
  const { email, password } = ACCOUNTS[who];
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Publications' })).toBeVisible();
}

/**
 * A short id unique to this test run. Records a test creates carry it, so a
 * test only ever looks at its own data: running it again (or a retry in CI)
 * cannot be confused by rows left from an earlier run.
 */
export function runId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Show only the caller's publications matching `text` (the run id), as a user would search. */
export async function showMine(page: Page, text: string): Promise<void> {
  await page.goto(`/?mine=true&q=${encodeURIComponent(text)}`);
  await expect(page.getByText(/publication\(s\)/)).toBeVisible();
}

/** Fails the test if the page shows a JavaScript dialog (e.g. an injected alert()). */
export function failOnDialog(page: Page): void {
  page.on('dialog', (dialog) => {
    throw new Error(`Unexpected dialog: ${dialog.message()}`);
  });
}

/** Collects console errors and CSP violations so a test can assert there were none. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // 401 on /api/auth/me is the normal "not logged in yet" check.
    if (msg.type() === 'error' && !msg.text().includes('401')) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}
