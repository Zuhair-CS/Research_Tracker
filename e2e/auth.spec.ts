import { expect, test } from '@playwright/test';
import { ACCOUNTS } from './env';
import { collectConsoleErrors, login } from './helpers';

test.describe('login', () => {
  test('a wrong password shows a generic error and keeps the user out', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/); // protected pages redirect to the login page
    await page.getByLabel('E-mail').fill(ACCOUNTS.researcher.email);
    await page.getByLabel('Password').fill('definitely-not-it');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a researcher logs in, sees their tools, and logs out', async ({ page, context }) => {
    const errors = collectConsoleErrors(page);
    await login(page, 'researcher');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add publication' })).toBeVisible();

    // The session cookie is HttpOnly (JavaScript cannot read it) and SameSite=Strict.
    const cookie = (await context.cookies()).find((c) => c.name === 'pubtrack.sid');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('pubtrack.sid');

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });

  test('a viewer gets read-only access', async ({ page }) => {
    await login(page, 'viewer');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add publication' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await page.goto('/publications/new');
    await expect(page.getByRole('heading', { name: 'Add publication' })).toHaveCount(0);
  });
});
