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
