import { expect, test } from '@playwright/test';
import { collectConsoleErrors, failOnDialog, login, runId, showMine } from './helpers';

test.describe('adding publications', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'researcher');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add publication' }).click();
    await expect(page.getByRole('heading', { name: 'Add publication' })).toBeVisible();
    // Wait until the department list has loaded and the researcher's department is preselected:
    // it is a required field, so saving before that is (correctly) blocked by the browser.
    await expect(page.getByLabel('Department *')).not.toHaveValue('');
  });

  test('add a publication by hand', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const title = `Threat modelling for university pipelines ${runId()}`;
    await page.getByLabel('Title *').fill(title);
    await page.getByLabel('Authors *').fill('Dr. Aisha Rahman\nSara Khan');
    await page.getByLabel('Journal / conference').fill('IEEE Secure Dev');
    await page.getByLabel('Year *').fill('2024');
    await page.getByLabel('Type *').selectOption({ label: 'Conference paper' });
    await page.getByRole('button', { name: 'Save publication' }).click();

    // Saving goes back to "my publications"; then find the new record.
    await expect(page).toHaveURL(/mine=true/);
    await showMine(page, title);
    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row).toContainText('Dr. Aisha Rahman, Sara Khan');
    await expect(row).toContainText('IEEE Secure Dev');
    await expect(row.getByRole('link', { name: 'Edit' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('auto-fill the form from a DOI (Crossref, mocked)', async ({ page }) => {
    const id = runId();
    const doi = `10.5555/e2e.${id}`;
    await page.getByLabel('DOI').fill(`https://doi.org/${doi.toUpperCase()}`);
    await page.getByRole('button', { name: 'Auto-fill from DOI' }).click();

    await expect(page.getByRole('status')).toContainText('Details filled in from Crossref');
    await expect(page.getByLabel('Title *')).toHaveValue(`Automated pipelines for secure research software ${id}`); // markup stripped
    await expect(page.getByLabel('Authors *')).toHaveValue('Aisha Rahman\nSara Khan');
    await expect(page.getByLabel('Journal / conference')).toHaveValue('Journal of Secure Software');
    await expect(page.getByLabel('Year *')).toHaveValue('2025');
    await expect(page.getByLabel('Type *')).toHaveValue('CONFERENCE_PAPER');
    await expect(page.getByLabel(/PDF link/)).toHaveValue('https://example.org/e2e-demo.pdf');

    await page.getByRole('button', { name: 'Save publication' }).click();
    await expect(page).toHaveURL(/mine=true/);
    await showMine(page, id);
    const row = page.getByRole('row').filter({ hasText: id });
    await expect(row.getByRole('link', { name: `DOI ${doi}` })).toHaveAttribute('href', `https://doi.org/${doi}`);

    // Looking the same DOI up again warns about the duplicate.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add publication' }).click();
    await page.getByLabel('DOI').fill(doi);
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
    const id = runId();
    const evil = `<img src=x onerror=alert(1)> XSS probe ${id}`;
    await page.getByLabel('Title *').fill(evil);
    await page.getByLabel('Authors *').fill('Dr. Aisha Rahman');
    await page.getByLabel('Year *').fill('2023');
    await page.getByRole('button', { name: 'Save publication' }).click();
    await expect(page).toHaveURL(/mine=true/);
    await showMine(page, id);
    await expect(page.getByRole('row').filter({ hasText: id }).locator('.pub-title')).toHaveText(evil);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });
});
