import { beforeEach, describe, expect, it } from 'vitest';
import { MAIN, ORCID_MAIN, UPES, installCatalog } from '../helpers/catalog.js';
import { CROSSREF, OPENALEX, ORCID, installFakeApis, when } from '../helpers/fake-apis.js';
import { createPublication, prisma, resetDb, type Fixtures } from '../helpers/db.js';
import { loginAll, type Client } from '../helpers/http.js';

const apis = installFakeApis();
let fx: Fixtures;
let admin: Client, aisha: Client, viewer: Client;

beforeEach(async () => {
  apis.reset();
  installCatalog(apis);
  fx = await resetDb();
  [admin, aisha, viewer] = await loginAll('admin@test.edu', 'aisha@test.edu', 'viewer@test.edu');
});

const titles = (list: { title: string }[]) => list.map((w) => w.title);

describe('config and people search', () => {
  it('names the configured university', async () => {
    const res = await viewer.get('/api/discover/config').expect(200);
    expect(res.body).toEqual({ institution: 'University of Petroleum and Energy Studies' });
  });

  it('browses everyone at the university, marking confirmed profiles', async () => {
    await prisma.user.update({ where: { id: fx.users.researcher.id }, data: { openalexAuthorId: MAIN } });
    const res = await viewer.get('/api/discover/people').expect(200);
    expect(res.body.total).toBe(4);
    expect(res.body.authors.find((a: { id: string }) => a.id === MAIN)).toMatchObject({
      name: 'Aisha Rahman',
      orcidId: ORCID_MAIN,
      institutions: ['University of Petroleum and Energy Studies'],
      linkedUser: { name: 'Aisha Rahman' },
    });
    const sent = apis.calls.find((u) => u.pathname === '/authors');
    expect(sent?.searchParams.get('filter')).toBe(`last_known_institutions.id:${UPES}`);
    expect(sent?.searchParams.get('sort')).toBe('works_count:desc');
    // The (optional) API key is never sent when it is not configured.
    expect(sent?.searchParams.has('api_key')).toBe(false);
  });

  it('searches by name with filters and sort', async () => {
    await viewer.get('/api/discover/people?q=Rahman&scope=all&hasOrcid=true&sort=citations&page=2').expect(200);
    const sent = apis.calls.find((u) => u.pathname === '/authors');
    expect(sent?.searchParams.get('search')).toBe('Rahman');
    expect(sent?.searchParams.get('filter')).toBe('has_orcid:true');
    expect(sent?.searchParams.get('sort')).toBe('cited_by_count:desc');
    expect(sent?.searchParams.get('page')).toBe('2');
  });

  it('looks a person up directly by ORCID iD', async () => {
    const res = await viewer.get(`/api/discover/people?q=https://orcid.org/${ORCID_MAIN}`).expect(200);
    expect(res.body.total).toBe(1);
  });

  it('rejects an ORCID iD with a wrong check digit instead of searching it as a name', async () => {
    const res = await viewer.get('/api/discover/people?q=0000-0002-1825-0098').expect(400);
    expect(res.body.error.code).toBe('INVALID_ORCID');
    expect(apis.calls).toHaveLength(0);
  });

  it('falls back to the ORCID record when no OpenAlex profile has the iD', async () => {
    const id = '0000-0001-5109-3700'; // valid, but on no OpenAlex profile in the catalogue
    apis.on(when(ORCID, `/v3.0/${id}/personal-details`, { body: { name: { 'given-names': { value: 'Aisha' }, 'family-name': { value: 'Rahman' }, 'credit-name': null } } }));
    apis.on(
      when(ORCID, `/v3.0/${id}/works`, {
        body: {
          group: [
            { 'work-summary': [{ 'put-code': 1, title: { title: { value: 'On ORCID only' } }, type: 'journal-article', 'publication-date': { year: { value: '2020' } }, 'external-ids': { 'external-id': [{ 'external-id-type': 'doi', 'external-id-value': '10.5555/W1', 'external-id-relationship': 'self' }] } }] },
            { 'work-summary': [{ 'put-code': 2, title: { title: { value: 'No DOI here' } }, type: 'book' }] },
          ],
        },
      }),
    );
    await createPublication(fx.users.researcher.id, fx.departments.cs.id, { doi: '10.5555/w1' });

    // Pasted with spaces and an en dash: still recognised.
    const res = await aisha.get(`/api/discover/people?q=${encodeURIComponent('0000 0001–5109 3700')}`).expect(200);
    expect(res.body.orcidRecord).toMatchObject({ orcidId: id, name: 'Aisha Rahman' });
    expect(res.body.orcidRecord.works.map((w: { title: string; sources: string[]; alreadyImported: boolean }) => [w.title, w.sources, w.alreadyImported])).toEqual([
      ['On ORCID only', ['orcid'], true],
      ['No DOI here', ['orcid'], false],
    ]);
    // Same-name OpenAlex profiles are suggested.
    expect(res.body.authors.map((a: { name: string }) => a.name)).toContain('Aisha Rahman');
  });

  it('404s an iD with no ORCID record', async () => {
    apis.on(when(ORCID, '/v3.0/0000-0001-5109-3700/personal-details', { status: 404 }));
    const res = await viewer.get('/api/discover/people?q=0000-0001-5109-3700').expect(404);
    expect(res.body.error.code).toBe('ORCID_NOT_FOUND');
  });

  it('validates the query', async () => {
    await viewer.get('/api/discover/people?scope=all').expect(400); // no name + whole world
    await viewer.get('/api/discover/people?q=a').expect(400);
    await viewer.get('/api/discover/people?sort=evil').expect(400);
  });
});

describe("a researcher's papers", () => {
  it('lists the profile, confirmed Crossref extras and unconfirmed possible matches', async () => {
    const res = await viewer.get(`/api/discover/people/${MAIN}/works?sort=newest`).expect(200);
    expect(res.body.total).toBe(2);
    expect(titles(res.body.works)).toEqual(['Deep learning for crop yield prediction', 'Soil moisture sensing at scale']);
    // Crossref copy of W1001 is not repeated; c2 has the same name AND UPES.
    expect(titles(res.body.crossrefExtras)).toEqual(['Crop rotation planning']);
    const possible = Object.fromEntries(res.body.possibleMatches.map((w: { title: string; matchNote: string }) => [w.title, w.matchNote]));
    expect(possible).toEqual({
      'Crop disease detection with drones': 'Same name and institution, but on another OpenAlex profile',
      'Irrigation scheduling with reinforcement learning': 'Same name and institution, but on another OpenAlex profile',
      'Crop yield datasets for South Asia': 'Same name on OpenAlex, but no affiliation is recorded',
      'A crop survey': 'Same name on Crossref, but no affiliation is recorded',
    });
    // Same name at another institution, or a different first name: dropped.
    expect(JSON.stringify(res.body)).not.toMatch(/Marine biology|Crop pricing|Crop genetics/);
    expect(res.body.warnings).toEqual([]);
  });

  it('merges extra profiles of the same person (?also=)', async () => {
    const res = await viewer.get(`/api/discover/people/${MAIN}/works?also=A1000002,A1000004`).expect(200);
    expect(res.body.total).toBe(4);
    expect(res.body.possibleMatches.map((w: { title: string }) => w.title)).not.toContain('Crop disease detection with drones');
    const sent = apis.calls.find((u) => u.searchParams.get('filter')?.startsWith('author.id:'));
    expect(sent?.searchParams.get('filter')).toBe(`author.id:${MAIN}|A1000002|A1000004`);
  });

  it('rejects anything but OpenAlex author ids (no filter injection)', async () => {
    await viewer.get('/api/discover/people/A1000001,doi:x/works').expect(400);
    await viewer.get(`/api/discover/people/${MAIN}/works?also=A1000002|A1`).expect(400);
    await viewer.get(`/api/discover/people/${MAIN}/works?also=${'A1000002,'.repeat(11)}`).expect(400);
    await viewer.get('/api/discover/people/A9/related').expect(400);
  });

  it('404s an unknown profile', async () => {
    await viewer.get('/api/discover/people/A1234567/works').expect(404);
  });

  it('skips Crossref for "open access only" and filters OpenAlex', async () => {
    const res = await viewer.get(`/api/discover/people/${MAIN}/works?oaOnly=true&yearFrom=2020&yearTo=2023&type=JOURNAL_ARTICLE`).expect(200);
    expect(titles(res.body.works)).toEqual(['Deep learning for crop yield prediction']);
    expect(apis.calls.some((u) => u.host === CROSSREF)).toBe(false);
    const sent = apis.calls.find((u) => u.searchParams.get('filter')?.startsWith('author.id:'));
    expect(sent?.searchParams.get('filter')).toContain('publication_year:2020-2023');
  });

  it('still answers when the extra look-ups fail, with a warning', async () => {
    apis.on(when(CROSSREF, '/works', { status: 500 }));
    apis.on(when(OPENALEX, '/works', { status: 500 }, (u) => Boolean(u.searchParams.get('filter')?.startsWith('raw_author_name'))));
    const res = await viewer.get(`/api/discover/people/${MAIN}/works`).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.warnings).toEqual([
      'Could not search OpenAlex for other papers under this name right now.',
      'Could not check Crossref for extra papers right now.',
    ]);
  });

  it('marks papers already in the researcher’s own account', async () => {
    await createPublication(fx.users.researcher.id, fx.departments.cs.id, { doi: '10.5555/w1' });
    const res = await aisha.get(`/api/discover/people/${MAIN}/works`).expect(200);
    const done = Object.fromEntries(res.body.works.map((w: { title: string; alreadyImported: boolean }) => [w.title, w.alreadyImported]));
    expect(done).toEqual({ 'Deep learning for crop yield prediction': true, 'Soil moisture sensing at scale': false });
    // Admins can check against any account.
    const forAisha = await admin.get(`/api/discover/people/${MAIN}/works?ownerId=${fx.users.researcher.id}`).expect(200);
    expect(forAisha.body.works[0].alreadyImported).toBe(true);
  });

  it('suggests other profiles that may be the same person', async () => {
    const res = await viewer.get(`/api/discover/people/${MAIN}/related`).expect(200);
    expect(res.body.profiles.map((p: { id: string; reason: string }) => [p.id, p.reason])).toEqual([
      ['A1000004', 'same-orcid'],
      ['A1000002', 'same-name'],
    ]);
  });
});

describe('publication search (OpenAlex + Crossref merged)', () => {
  it('merges duplicates and filters Crossref hits to the university', async () => {
    const res = await viewer.get('/api/discover/works?q=crop').expect(200);
    const byTitle = Object.fromEntries(res.body.works.map((w: { title: string; sources: string[] }) => [w.title, w.sources]));
    expect(byTitle['Deep learning for crop yield prediction']).toEqual(['openalex', 'crossref']);
    expect(byTitle['Crop rotation planning']).toEqual(['crossref']);
    // No UPES affiliation on Crossref: not shown in a university-only search.
    expect(byTitle['A crop survey']).toBeUndefined();
    expect(byTitle['Crop genetics']).toBeUndefined();
    expect(res.body.totals).toEqual({ openalex: 2, crossref: 1234 });
    const oa = apis.calls.find((u) => u.host === OPENALEX && u.pathname === '/works');
    expect(oa?.searchParams.get('filter')).toBe(`authorships.institutions.id:${UPES}`);
  });

  it('can search everywhere, by author, sorted by citations', async () => {
    const res = await viewer.get('/api/discover/works?q=crop&author=Aisha%20Rahman&scope=all&sort=citations').expect(200);
    const list = titles(res.body.works);
    expect(list[0]).toBe('Crop rotation planning'); // 99 citations
    expect(list).toContain('A crop survey');
    expect(list).not.toContain('Crop pricing'); // "Anil Rahman" is someone else
  });

  it('uses one source on request, and warns about Crossref for open-access-only', async () => {
    const crossrefOnly = await viewer.get('/api/discover/works?q=crop&sources=crossref').expect(200);
    expect(crossrefOnly.body.totals.openalex).toBe(0);
    const oaOnly = await viewer.get('/api/discover/works?q=crop&oaOnly=true&sort=newest').expect(200);
    expect(oaOnly.body.warnings).toEqual(['Crossref has no open-access flag, so only OpenAlex was searched.']);
  });

  it('falls back to the other source when one fails', async () => {
    apis.on(when(OPENALEX, '/works', { status: 429 }));
    const res = await viewer.get('/api/discover/works?q=crop').expect(200);
    expect(res.body.warnings[0]).toMatch(/OpenAlex is limiting requests.*Showing Crossref results only/);
    apis.on(when(OPENALEX, '/works', { status: 500 }));
    apis.on(when(CROSSREF, '/works', { throws: new Error('ECONNRESET') }));
    const both = await viewer.get('/api/discover/works?q=crop').expect(200);
    expect(both.body.works).toEqual([]);
    expect(both.body.warnings).toHaveLength(2);
  });

  it('needs a query to search the whole world', async () => {
    await viewer.get('/api/discover/works?scope=all').expect(400);
    await viewer.get('/api/discover/works').expect(200); // browse the university
  });
});

describe('import into my account', () => {
  it('a researcher imports, re-fetching data on the server; duplicates are skipped', async () => {
    const body = { works: [{ openalexId: 'W1001' }, { doi: 'https://doi.org/10.5555/C2' }, { doi: '10.5555/missing' }] };
    const res = await aisha.send('post', '/api/discover/import', body).expect(200);
    expect(titles(res.body.imported).sort()).toEqual(['Crop rotation planning', 'Deep learning for crop yield prediction']);
    expect(res.body.skipped).toEqual([{ ref: { doi: '10.5555/missing' }, title: '', reason: 'Not found in Crossref' }]);
    const saved = await prisma.publication.findMany({ where: { ownerId: fx.users.researcher.id }, orderBy: { title: 'asc' } });
    expect(saved.map((p) => [p.source, p.departmentId])).toEqual([
      ['CROSSREF', fx.departments.cs.id],
      ['OPENALEX', fx.departments.cs.id],
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'OPENALEX_IMPORT' } })).toBe(1);

    const again = await aisha.send('post', '/api/discover/import', { works: [{ openalexId: 'W1001' }] }).expect(200);
    expect(again.body.skipped[0].reason).toBe('Already in this account');
  });

  it('only researchers may import, only into their own account', async () => {
    const body = { works: [{ openalexId: 'W1001' }] };
    await admin.send('post', '/api/discover/import', body).expect(403);
    await viewer.send('post', '/api/discover/import', body).expect(403);
    await aisha.send('post', '/api/discover/import', { ...body, ownerId: fx.users.other.id }).expect(400);
  });

  it('validates references and the department', async () => {
    await aisha.send('post', '/api/discover/import', { works: [] }).expect(400);
    await aisha.send('post', '/api/discover/import', { works: [{ openalexId: 'W1|W2' }] }).expect(400);
    await aisha.send('post', '/api/discover/import', { works: [{}] }).expect(400);
    const dept = await aisha
      .send('post', '/api/discover/import', { works: [{ openalexId: 'W1001' }], departmentId: crypto.randomUUID() })
      .expect(400);
    expect(dept.body.error.code).toBe('UNKNOWN_DEPARTMENT');
  });

  it('asks for a department when the researcher has none', async () => {
    await prisma.user.update({ where: { id: fx.users.researcher.id }, data: { departmentId: null } });
    const res = await aisha.send('post', '/api/discover/import', { works: [{ openalexId: 'W1001' }] }).expect(400);
    expect(res.body.error.message).toMatch(/department/);
  });
});
