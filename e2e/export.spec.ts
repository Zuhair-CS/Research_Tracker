import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('CSV export', () => {
  test('downloads the publication list as CSV', async ({ page }) => {
    await login(page, 'viewer'); // read-only users may export too
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    expect(download.suggestedFilename()).toMatch(/^publications-\d{4}-\d{2}-\d{2}\.csv$/);

    const csv = (await readFile(await download.path(), 'utf8')).replace(/^FEFF/, '');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('"Title","Authors","Journal / Conference","Year","DOI","Type","Department","PDF link","Added by","Source"');
    expect(lines.length).toBeGreaterThan(10); // the seeded sample publications
    expect(csv).not.toMatch(/@e2e\.test/); // no e-mail addresses in the export
  });

  test('exports only what the current filters show', async ({ page }) => {
    await login(page, 'researcher');
    await page.getByPlaceholder('Title, venue, DOI or author').fill('Supply-Chain Attacks');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=Supply-Chain/);

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    const csv = await readFile(await download.path(), 'utf8');
    const rows = csv.trim().split('\r\n').slice(1);
    expect(rows).toHaveLength(1);
    for (const row of rows) expect(row).toContain('Supply-Chain Attacks');
  });
});
