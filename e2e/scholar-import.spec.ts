import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { collectConsoleErrors, login, runId, showMine } from './helpers';

const SAMPLE = readFileSync(path.join(__dirname, '..', 'apps', 'api', 'test', 'fixtures', 'scholar-export.bib'), 'utf8');

test('import a Google Scholar BibTeX export: preview, choose, import', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  // Tag every title and DOI with this run's id, so the papers are new on every run.
  const id = runId();
  const bib = SAMPLE.replace(/title\s*=\s*([{"])/g, `title = $1${id} `).replace(/doi=\{([^}]+)\}/g, `doi={$1.${id}}`);

  await login(page, 'researcher');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Scholar import' }).click();
  await expect(page.getByRole('heading', { name: 'Import from Google Scholar' })).toBeVisible();

  // Step 1: preview. Nothing is saved yet.
  await page.getByLabel('BibTeX file').setInputFiles({ name: 'citations.bib', mimeType: 'text/plain', buffer: Buffer.from(bib) });
  await expect(page.getByText('9 entries read')).toBeVisible();
  await expect(page.getByText('7 new')).toBeVisible();
  const noYear = page.getByRole('row').filter({ hasText: 'A note without a year' });
  await expect(noYear).toContainText('Cannot import');
  await expect(noYear.getByRole('checkbox')).toBeDisabled();
  // The duplicate inside the file is caught too.
  await expect(page.getByRole('row').filter({ hasText: 'Listed twice in the file' })).toHaveCount(1);
  // Accented names are converted from LaTeX.
  await expect(page.getByRole('row').filter({ hasText: 'Large language models' })).toContainText('Jörg Müller');

  // Step 2: untick one, import the rest.
  await page.getByRole('row').filter({ hasText: 'Keynote: Clean cooking fuels' }).getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: 'Import selected (6)' }).click();
  await expect(page.getByRole('status')).toContainText('Imported 6 publication(s)');
  // The preview refreshes: the 6 imported papers, plus the copy listed twice, now count as already in the account.
  await expect(page.getByText('7 already in your publications')).toBeVisible();

  await showMine(page, id);
  await expect(page.getByText('6 publication(s)')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Biomass gasifiers in rural India' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Keynote: Clean cooking fuels' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
