import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CROSSREF, crossrefItem, crossrefWork, installFakeApis, when } from '../helpers/fake-apis.js';
import { createPublication, prisma, resetDb, type Fixtures } from '../helpers/db.js';
import { anonymous, loginAll, type Client } from '../helpers/http.js';

const apis = installFakeApis();
let fx: Fixtures;
let admin: Client, aisha: Client, bob: Client, viewer: Client;

beforeEach(async () => {
  apis.reset();
  fx = await resetDb();
  [admin, aisha, bob, viewer] = await loginAll('admin@test.edu', 'aisha@test.edu', 'bob@test.edu', 'viewer@test.edu');
});

const input = () => ({
  title: 'Graph neural networks for power grids',
  authors: ['Aisha Rahman', 'Bob Kumar'],
  venue: 'IEEE Access',
  year: 2024,
  doi: 'https://doi.org/10.5555/GNN.2024',
  type: 'JOURNAL_ARTICLE',
  departmentId: fx.departments.cs.id,
  pdfUrl: 'https://example.org/gnn.pdf',
});

describe('list and read (every role)', () => {
  beforeEach(async () => {
    const { cs, ee } = fx.departments;
    await createPublication(fx.users.researcher.id, cs.id, { title: 'Alpha', year: 2020, doi: '10.5555/a', authors: ['Aisha Rahman'] });
    await createPublication(fx.users.researcher.id, cs.id, { title: 'Beta', year: 2022, type: 'BOOK', venue: 'Springer' });
    await createPublication(fx.users.other.id, ee.id, { title: 'Gamma', year: 2024, authors: ['Bob Kumar'] });
  });

  it.each(['admin', 'researcher', 'viewer'] as const)('%s can browse', async (who) => {
    const client = { admin, researcher: aisha, viewer }[who];
    const res = await client.get('/api/publications').expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((p: { title: string }) => p.title)).toEqual(['Gamma', 'Beta', 'Alpha']);
    // Personal data never leaks through the public list.
    expect(JSON.stringify(res.body)).not.toContain('@test.edu');
  });

  it('marks which records the caller may edit', async () => {
    const res = await aisha.get('/api/publications').expect(200);
    const editable = Object.fromEntries(res.body.items.map((p: { title: string; canEdit: boolean }) => [p.title, p.canEdit]));
    expect(editable).toEqual({ Alpha: true, Beta: true, Gamma: false });
    const v = await viewer.get('/api/publications').expect(200);
    expect(v.body.items.every((p: { canEdit: boolean }) => !p.canEdit)).toBe(true);
  });

  it.each([
    ['q=alpha', ['Alpha']],
    ['q=springer', ['Beta']],
    ['q=10.5555/a', ['Alpha']],
    ['author=bob', ['Gamma']],
    ['type=BOOK', ['Beta']],
    ['year=2020', ['Alpha']],
    ['yearFrom=2021&yearTo=2023', ['Beta']],
    ['mine=true', ['Beta', 'Alpha']],
    ['sort=title_asc', ['Alpha', 'Beta', 'Gamma']],
    ['sort=year_asc', ['Alpha', 'Beta', 'Gamma']],
    ['sort=created_desc&pageSize=1&page=2', ['Beta']],
  ])('filters: %s', async (query, titles) => {
    const res = await aisha.get(`/api/publications?${query}`).expect(200);
    expect(res.body.items.map((p: { title: string }) => p.title)).toEqual(titles);
  });

  it('filters by department', async () => {
    const res = await aisha.get(`/api/publications?departmentId=${fx.departments.ee.id}`).expect(200);
    expect(res.body.items.map((p: { title: string }) => p.title)).toEqual(['Gamma']);
  });

  it('rejects unknown or malformed query parameters', async () => {
    await aisha.get('/api/publications?ownerId=x').expect(400);
    await aisha.get('/api/publications?pageSize=1000').expect(400);
    await aisha.get('/api/publications?sort=password').expect(400);
  });

  it('reads one publication; 404 for unknown, 400 for a bad id', async () => {
    const p = await prisma.publication.findFirstOrThrow({ where: { title: 'Alpha' } });
    const res = await viewer.get(`/api/publications/${p.id}`).expect(200);
    expect(res.body).toMatchObject({ title: 'Alpha', authors: ['Aisha Rahman'], canEdit: false, owner: { name: 'Aisha Rahman' } });
    await viewer.get(`/api/publications/${crypto.randomUUID()}`).expect(404);
    await viewer.get('/api/publications/1%20OR%201=1').expect(400);
  });
});

describe('create', () => {
  it('a researcher creates a publication they own, audited', async () => {
    const res = await aisha.send('post', '/api/publications', input()).expect(201);
    expect(res.body).toMatchObject({ doi: '10.5555/gnn.2024', owner: { id: fx.users.researcher.id }, source: 'MANUAL', canEdit: true });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PUBLICATION_CREATE' } });
    expect(audit).toMatchObject({ actorId: fx.users.researcher.id, entityId: res.body.id });
  });

  it.each([
    ['admin', 403],
    ['viewer', 403],
  ] as const)('%s cannot create (%i)', async (who, status) => {
    await { admin, viewer }[who].send('post', '/api/publications', input()).expect(status);
  });

  it('anonymous users get 401', async () => {
    const anon = await anonymous();
    await anon.send('post', '/api/publications', input()).expect(401);
  });

  it('ignores no field: ownerId / id in the body are rejected (mass assignment)', async () => {
    const res = await aisha.send('post', '/api/publications', { ...input(), ownerId: fx.users.other.id }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await aisha.send('post', '/api/publications', { ...input(), id: crypto.randomUUID() }).expect(400);
  });

  it.each([
    ['javascript: PDF link (stored XSS)', { pdfUrl: 'javascript:alert(1)' }],
    ['http PDF link', { pdfUrl: 'http://example.org/a.pdf' }],
    ['invalid DOI', { doi: 'not-a-doi' }],
    ['no authors', { authors: [] }],
    ['year in the future', { year: 3000 }],
    ['empty title', { title: '   ' }],
  ])('rejects %s', async (_case, patch) => {
    await aisha.send('post', '/api/publications', { ...input(), ...patch }).expect(400);
  });

  it('accepts an empty PDF link and no DOI', async () => {
    const res = await aisha.send('post', '/api/publications', { ...input(), pdfUrl: '', doi: null, venue: '' }).expect(201);
    expect(res.body).toMatchObject({ pdfUrl: null, doi: null, venue: null });
  });

  it('rejects an unknown department and a duplicate DOI for the same owner', async () => {
    const dept = await aisha.send('post', '/api/publications', { ...input(), departmentId: crypto.randomUUID() }).expect(400);
    expect(dept.body.error.code).toBe('UNKNOWN_DEPARTMENT');
    await aisha.send('post', '/api/publications', input()).expect(201);
    await aisha.send('post', '/api/publications', { ...input(), doi: '10.5555/gnn.2024' }).expect(409);
    // Another researcher may record the same paper.
    await bob.send('post', '/api/publications', input()).expect(201);
  });
});

describe('update and delete (ownership checks)', () => {
  let mine: string;
  beforeEach(async () => {
    mine = (await createPublication(fx.users.researcher.id, fx.departments.cs.id, { doi: '10.5555/mine' })).id;
  });

  it('the owner can update; authors are replaced in order', async () => {
    const res = await aisha.send('put', `/api/publications/${mine}`, { ...input(), authors: ['Z', 'A'] }).expect(200);
    expect(res.body).toMatchObject({ title: 'Graph neural networks for power grids', authors: ['Z', 'A'] });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PUBLICATION_UPDATE' } });
    expect(audit.before).toMatchObject({ title: 'A study of testing' });
  });

  it("another researcher cannot change someone else's publication (BOLA)", async () => {
    const put = await bob.send('put', `/api/publications/${mine}`, input()).expect(403);
    expect(put.body.error.code).toBe('FORBIDDEN');
    await bob.send('delete', `/api/publications/${mine}`).expect(403);
    expect(await prisma.publication.count({ where: { id: mine } })).toBe(1);
  });

  it('viewers can never change anything', async () => {
    await viewer.send('put', `/api/publications/${mine}`, input()).expect(403);
    await viewer.send('delete', `/api/publications/${mine}`).expect(403);
  });

  it('admins can edit and delete any publication', async () => {
    await admin.send('put', `/api/publications/${mine}`, input()).expect(200);
    await admin.send('delete', `/api/publications/${mine}`).expect(204);
    expect(await prisma.auditLog.count({ where: { action: 'PUBLICATION_DELETE', actorId: fx.users.admin.id } })).toBe(1);
  });

  it('404 for unknown ids, 409 when the DOI clashes with another of the owner’s records', async () => {
    await aisha.send('put', `/api/publications/${crypto.randomUUID()}`, input()).expect(404);
    await aisha.send('delete', `/api/publications/${crypto.randomUUID()}`).expect(404);
    await createPublication(fx.users.researcher.id, fx.departments.cs.id, { doi: '10.5555/other' });
    await aisha.send('put', `/api/publications/${mine}`, { ...input(), doi: '10.5555/other' }).expect(409);
    // Keeping its own DOI is fine.
    await aisha.send('put', `/api/publications/${mine}`, { ...input(), doi: '10.5555/mine' }).expect(200);
  });

  it('the owner can delete', async () => {
    await aisha.send('delete', `/api/publications/${mine}`).expect(204);
    await aisha.get(`/api/publications/${mine}`).expect(404);
  });
});

describe('DOI auto-fill (Crossref, mocked)', () => {
  beforeAll(() => {
    apis.reset();
  });

  it('returns a draft from Crossref and flags an existing copy', async () => {
    apis.on(when(CROSSREF, '/works/10.5555%2Fgnn.2024', { body: crossrefWork(crossrefItem({ DOI: '10.5555/GNN.2024' })) }));
    const res = await aisha.get('/api/publications/lookup/doi?doi=doi:10.5555/GNN.2024').expect(200);
    expect(res.body.draft).toMatchObject({
      title: 'Deep learning for crop yield prediction',
      authors: ['Aisha Rahman'],
      venue: 'Journal of Testing',
      year: 2023,
      doi: '10.5555/gnn.2024',
      type: 'JOURNAL_ARTICLE',
      pdfUrl: 'https://example.org/paper.pdf',
    });
    expect(res.body.alreadyAddedId).toBeNull();
    // The DOI was URL-encoded into one path segment of the fixed Crossref host (SSRF defence).
    expect(apis.calls[0]?.href).toBe('https://api.crossref.org/works/10.5555%2Fgnn.2024');

    const existing = await createPublication(fx.users.researcher.id, fx.departments.cs.id, { doi: '10.5555/gnn.2024' });
    const again = await aisha.get('/api/publications/lookup/doi?doi=10.5555/gnn.2024').expect(200);
    expect(again.body.alreadyAddedId).toBe(existing.id);
  });

  it('admins may look up; viewers may not', async () => {
    apis.on(when(CROSSREF, '/works/', { body: crossrefWork(crossrefItem({ DOI: '10.5555/x' })) }));
    await admin.get('/api/publications/lookup/doi?doi=10.5555/x').expect(200);
    await viewer.get('/api/publications/lookup/doi?doi=10.5555/x').expect(403);
    expect(apis.calls).toHaveLength(1);
  });

  it('rejects malformed DOIs before calling Crossref', async () => {
    for (const doi of ['../../admin', 'http://169.254.169.254/latest', '10.5555', '']) {
      await aisha.get(`/api/publications/lookup/doi?doi=${encodeURIComponent(doi)}`).expect(400);
    }
    expect(apis.calls).toHaveLength(0);
  });

  it('maps upstream answers: 404 -> 404, error -> 502, rate limit -> 503', async () => {
    apis.on(when(CROSSREF, '/works/10.5555%2Fmissing', { status: 404 }));
    apis.on(when(CROSSREF, '/works/10.5555%2Fbroken', { status: 500 }));
    apis.on(when(CROSSREF, '/works/10.5555%2Fbusy', { status: 429 }));
    await aisha.get('/api/publications/lookup/doi?doi=10.5555/missing').expect(404);
    const broken = await aisha.get('/api/publications/lookup/doi?doi=10.5555/broken').expect(502);
    expect(broken.body.error.code).toBe('UPSTREAM_ERROR');
    const busy = await aisha.get('/api/publications/lookup/doi?doi=10.5555/busy').expect(503);
    expect(busy.body.error.code).toBe('UPSTREAM_RATE_LIMITED');
  });
});
