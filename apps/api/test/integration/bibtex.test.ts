import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPublication, prisma, resetDb, type Fixtures } from '../helpers/db.js';
import { anonymous, loginAll, type Client } from '../helpers/http.js';

const SAMPLE = readFileSync(new URL('../fixtures/scholar-export.bib', import.meta.url), 'utf8');

let fx: Fixtures;
let admin: Client, aisha: Client, viewer: Client;

beforeEach(async () => {
  fx = await resetDb();
  [admin, aisha, viewer] = await loginAll('admin@test.edu', 'aisha@test.edu', 'viewer@test.edu');
});

const upload = (client: Client, path: string, text: string) => client.send('post', path).set('Content-Type', 'text/plain; charset=utf-8').send(text);

interface Candidate {
  index: number;
  title: string;
  status: string;
  reason?: string;
}

describe('BibTeX preview', () => {
  it('reads the file, marks duplicates and invalid entries, and saves nothing', async () => {
    await createPublication(fx.users.researcher.id, fx.departments.cs.id, { title: 'IoT-based monitoring of greenhouse humidity', year: 2022 });
    const res = await upload(aisha, '/api/import/bibtex/preview', SAMPLE).expect(200);
    expect(res.body.stats).toEqual({ entries: 9, new: 6, duplicate: 2, invalid: 1 });
    const byIndex = Object.fromEntries((res.body.candidates as Candidate[]).map((c) => [c.index, [c.status, c.reason ?? '']]));
    expect(byIndex).toMatchObject({
      0: ['new', ''],
      1: ['duplicate', 'Already in your publications'],
      6: ['invalid', 'No year'],
      7: ['duplicate', 'Listed twice in the file'],
    });
    expect(res.body.errors).toEqual([]);
    expect(await prisma.publication.count()).toBe(1);
  });

  it('returns parse problems with line numbers', async () => {
    const res = await upload(aisha, '/api/import/bibtex/preview', '@article{ok, title={A}, author={B, C}, year=2020}\n@article{broken, title = }').expect(200);
    expect(res.body.stats.entries).toBe(1);
    expect(res.body.errors).toEqual([{ line: 2, message: 'Expected a value after "="' }]);
  });

  it('only researchers may use it (admins and viewers get 403, anonymous 401)', async () => {
    await upload(admin, '/api/import/bibtex/preview', SAMPLE).expect(403);
    await upload(viewer, '/api/import/bibtex/preview', SAMPLE).expect(403);
    await upload(viewer, '/api/import/bibtex?select=0', SAMPLE).expect(403);
    const anon = await anonymous();
    await upload(anon, '/api/import/bibtex/preview', SAMPLE).expect(401);
  });

  it('needs the CSRF token like every other change', async () => {
    const res = await aisha.agent.post('/api/import/bibtex/preview').set('Content-Type', 'text/plain').send(SAMPLE).expect(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('accepts only a non-empty plain-text upload of at most 1 MB', async () => {
    const empty = await upload(aisha, '/api/import/bibtex/preview', '   ').expect(400);
    expect(empty.body.error.code).toBe('BIBTEX_EMPTY');
    const json = await aisha.send('post', '/api/import/bibtex/preview', { bibtex: SAMPLE }).expect(400);
    expect(json.body.error.code).toBe('BIBTEX_EMPTY');
    await upload(aisha, '/api/import/bibtex/preview', 'x'.repeat(1_000_001)).expect(413);
  });
});

describe('BibTeX import', () => {
  it('imports the selected new entries into the researcher’s own account, audited', async () => {
    const res = await upload(aisha, '/api/import/bibtex?select=0,3,5,6,7', SAMPLE).expect(200);
    expect(res.body.imported.map((p: { title: string }) => p.title)).toEqual([
      'Solar-assisted drying of agricultural produce: a review',
      'Large language models for crop advisories',
      'Biomass gasifiers in rural India',
    ]);
    expect(res.body.skipped).toEqual([
      { index: 6, title: 'A note without a year', reason: 'No year' },
      { index: 7, title: 'Solar-assisted drying of agricultural produce: A Review', reason: 'Listed twice in the file' },
    ]);

    const saved = await prisma.publication.findMany({ where: { ownerId: fx.users.researcher.id }, include: { authors: { orderBy: { position: 'asc' } } }, orderBy: { year: 'desc' } });
    expect(saved.map((p) => [p.source, p.type, p.departmentId, p.doi])).toEqual([
      ['BIBTEX', 'PREPRINT', fx.departments.cs.id, null],
      ['BIBTEX', 'JOURNAL_ARTICLE', fx.departments.cs.id, null],
      ['BIBTEX', 'BOOK_CHAPTER', fx.departments.cs.id, '10.5555/hre.2019.007'],
    ]);
    expect(saved[0]?.authors.map((a) => a.name)).toEqual(['Srashti Rastogi', 'Jörg Müller', 'José García']);
    expect(await prisma.auditLog.count({ where: { action: 'PUBLICATION_CREATE' } })).toBe(3);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'BIBTEX_IMPORT' } });
    expect(audit.after).toEqual({ requested: 5, imported: 3, skipped: 2 });
  });

  it('never imports the same paper twice', async () => {
    await upload(aisha, '/api/import/bibtex?select=0,1', SAMPLE).expect(200);
    const again = await upload(aisha, '/api/import/bibtex?select=0,1', SAMPLE).expect(200);
    expect(again.body.imported).toEqual([]);
    expect(again.body.skipped.map((s: { reason: string }) => s.reason)).toEqual(['Already in your publications', 'Already in your publications']);
    const preview = await upload(aisha, '/api/import/bibtex/preview', SAMPLE).expect(200);
    expect(preview.body.stats.duplicate).toBe(3); // the two imported + the copy in the file
  });

  it('uses a chosen department, and checks it exists', async () => {
    await upload(aisha, `/api/import/bibtex?select=2&departmentId=${fx.departments.ee.id}`, SAMPLE).expect(200);
    expect((await prisma.publication.findFirstOrThrow()).departmentId).toBe(fx.departments.ee.id);
    const res = await upload(aisha, `/api/import/bibtex?select=0&departmentId=${crypto.randomUUID()}`, SAMPLE).expect(400);
    expect(res.body.error.code).toBe('UNKNOWN_DEPARTMENT');
  });

  it('asks for a department when the researcher has none', async () => {
    await prisma.user.update({ where: { id: fx.users.researcher.id }, data: { departmentId: null } });
    await upload(aisha, '/api/import/bibtex?select=0', SAMPLE).expect(400);
  });

  it.each(['', 'select=', 'select=a,b', 'select=1;DROP', 'select=0&ownerId=x', `select=${'1,'.repeat(3000)}1`])(
    'validates the query: %s',
    async (query) => {
      await upload(aisha, `/api/import/bibtex?${query}`, SAMPLE).expect(400);
    },
  );

  it('ignores entry numbers that are not in the file', async () => {
    const res = await upload(aisha, '/api/import/bibtex?select=999', SAMPLE).expect(200);
    expect(res.body).toEqual({ imported: [], skipped: [] });
  });

  it('rate-limits uploads per user (30 per 15 minutes)', async () => {
    let status = 200;
    for (let n = 0; n < 31 && status !== 429; n++) status = (await upload(aisha, '/api/import/bibtex/preview', '@misc{a, year = 2020}')).status;
    expect(status).toBe(429);
  });
});
