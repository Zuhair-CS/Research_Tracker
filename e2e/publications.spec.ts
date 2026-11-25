import { expect, test } from '@playwright/test';
import { collectConsoleErrors, failOnDialog, login } from './helpers';

test.describe('adding publications', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'researcher');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add publication' }).click();
    await expect(page.getByRole('heading', { name: 'Add publication' })).toBeVisible();
  });

  test('add a publication by hand', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.getByLabel('Title *').fill('Threat modelling for university pipelines');
    await page.getByLabel('Authors *').fill('Dr. Aisha Rahman\nSara Khan');
    await page.getByLabel('Journal / conference').fill('IEEE Secure Dev');
    await page.getByLabel('Year *').fill('2024');
    await page.getByLabel('Type *').selectOption({ label: 'Conference paper' });
    await page.getByRole('button', { name: 'Save publication' }).click();

    // Back on the list, filtered to "mine", with the new record.
    await expect(page).toHaveURL(/mine=true/);
    const row = page.getByRole('row').filter({ hasText: 'Threat modelling for university pipelines' });
    await expect(row).toContainText('Dr. Aisha Rahman, Sara Khan');
    await expect(row).toContainText('IEEE Secure Dev');
    await expect(row.getByRole('link', { name: 'Edit' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('auto-fill the form from a DOI (Crossref, mocked)', async ({ page }) => {
    await page.getByLabel('DOI').fill('https://doi.org/10.5555/E2E.DEMO');
    await page.getByRole('button', { name: 'Auto-fill from DOI' }).click();

    await expect(page.getByRole('status')).toContainText('Details filled in from Crossref');
    await expect(page.getByLabel('Title *')).toHaveValue('Automated pipelines for secure research software'); // markup stripped
    await expect(page.getByLabel('Authors *')).toHaveValue('Aisha Rahman\nSara Khan');
    await expect(page.getByLabel('Journal / conference')).toHaveValue('Journal of Secure Software');
    await expect(page.getByLabel('Year *')).toHaveValue('2025');
    await expect(page.getByLabel('Type *')).toHaveValue('CONFERENCE_PAPER');
    await expect(page.getByLabel(/PDF link/)).toHaveValue('https://example.org/e2e-demo.pdf');

    await page.getByRole('button', { name: 'Save publication' }).click();
    const row = page.getByRole('row').filter({ hasText: 'Automated pipelines for secure research software' });
    await expect(row.getByRole('link', { name: 'DOI 10.5555/e2e.demo' })).toHaveAttribute('href', 'https://doi.org/10.5555/e2e.demo');

    // Looking the same DOI up again warns about the duplicate.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add publication' }).click();
    await page.getByLabel('DOI').fill('10.5555/e2e.demo');
    await page.getByRole('button', { name: 'Auto-fill from DOI' }).click();
    await expect(page.getByRole('status')).toContainText('already added a publication with this DOI');
  });

  test('an unknown DOI shows an error and fills nothing', async ({ page }) => {
    await page.getByLabel('DOI').fill('10.5555/does-not-exist');
    await page.getByRole('button', { name: 'Auto-fill from DOI' }).click();
    await expect(page.getByRole('alert')).toContainText('DOI not found');
    await expect(page.getByLabel('Title *')).toHaveValue('');
  });

  test('a title containing HTML is shown as text, never run (stored XSS)', async ({ page }) => {
    failOnDialog(page);
    const evil = '<img src=x onerror=alert(1)> XSS probe';
    await page.getByLabel('Title *').fill(evil);
    await page.getByLabel('Authors *').fill('Dr. Aisha Rahman');
    await page.getByLabel('Year *').fill('2023');
    await page.getByRole('button', { name: 'Save publication' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'XSS probe' }).locator('.pub-title')).toHaveText(evil);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });
});
