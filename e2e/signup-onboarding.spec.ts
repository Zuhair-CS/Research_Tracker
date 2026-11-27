import { expect, test } from '@playwright/test';
import { collectConsoleErrors, login, runId } from './helpers';

test('new faculty: sign up, wait for approval, then get pointed to the Scholar import', async ({ browser }) => {
  const id = runId();
  const email = `faculty.${id}@e2e.test`;
  const name = `Dr. Test Faculty ${id}`;

  // 1. Sign up. The account starts read-only and says what happens next.
  const faculty = await (await browser.newContext()).newPage();
  const errors = collectConsoleErrors(faculty);
  await faculty.goto('/signup');
  await faculty.getByLabel('Full name').fill(name);
  await faculty.getByLabel('University e-mail').fill(email);
  await faculty.getByLabel('I am').selectOption('FACULTY');
  await faculty.getByLabel('Department').selectOption({ index: 1 });
  await faculty.getByLabel('Password (at least 12 characters)').fill('e2e-faculty-password-1');
  await faculty.getByLabel('Confirm password').fill('e2e-faculty-password-1');
  await faculty.getByRole('button', { name: 'Create account' }).click();
  await expect(faculty.getByText(/waiting for an administrator.*import your Google Scholar list/)).toBeVisible();
  await expect(faculty.getByRole('link', { name: 'Scholar import' })).toHaveCount(0);

  // 2. An admin approves the faculty access.
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  await admin.goto('/admin/users');
  await admin.getByRole('row').filter({ hasText: email }).getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByText(`Approved ${name}`)).toBeVisible();

  // 3. The faculty member is now a researcher: notification, menu link and a "get started" prompt.
  await faculty.reload();
  await expect(faculty.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Scholar import' })).toBeVisible();
  const prompt = faculty.getByRole('region', { name: 'Get started' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('link', { name: 'Import from Google Scholar' }).click();
  await expect(faculty.getByRole('heading', { name: 'Import from Google Scholar' })).toBeVisible();

  await faculty.goto('/notifications');
  await expect(faculty.getByText(/access was approved\. Start by importing your Google Scholar list/)).toBeVisible();
  expect(errors).toEqual([]);
});
