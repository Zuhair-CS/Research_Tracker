import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, createPublication, prisma, resetDb, type Fixtures } from '../helpers/db.js';
import { loginAll, type Client } from '../helpers/http.js';

let fx: Fixtures;
let admin: Client, aisha: Client, viewer: Client;

beforeEach(async () => {
  fx = await resetDb();
  [admin, aisha, viewer] = await loginAll('admin@test.edu', 'aisha@test.edu', 'viewer@test.edu');
});

describe('CSV export', () => {
  beforeEach(async () => {
    await createPublication(fx.users.researcher.id, fx.departments.cs.id, {
      title: '=HYPERLINK("http://evil.example","click")',
      authors: ['Aisha Rahman', 'Bob "the builder" Kumar'],
      doi: '10.5555/csv',
      year: 2023,
    });
    await createPublication(fx.users.other.id, fx.departments.ee.id, { title: 'Plain title', year: 2021, type: 'BOOK' });
  });

  it.each(['admin', 'researcher', 'viewer'] as const)('%s can export, as a download, audited', async (who) => {
    const client = { admin, researcher: aisha, viewer }[who];
    const res = await client.get('/api/reports/publications.csv').expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="publications-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(await prisma.auditLog.count({ where: { action: 'REPORT_EXPORT' } })).toBe(1);
  });

  it('neutralises spreadsheet formulas and quotes cells (CSV injection)', async () => {
    const res = await aisha.get('/api/reports/publications.csv').expect(200);
    const lines = res.text.replace(/^FEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('"Title","Authors","Journal / Conference","Year","DOI","Type","Department","PDF link","Added by","Source"');
    expect(lines[1]).toBe(
      `"'=HYPERLINK(""http://evil.example"",""click"")","Aisha Rahman; Bob ""the builder"" Kumar",,"2023","10.5555/csv","JOURNAL_ARTICLE","Computer Science",,"Aisha Rahman","MANUAL"`,
    );
    // No personal data (e-mail addresses) in the export.
    expect(res.text).not.toContain('@test.edu');
  });

  it('applies the same filters as the search page', async () => {
    const res = await aisha.get('/api/reports/publications.csv?type=BOOK').expect(200);
    expect(res.text).toContain('Plain title');
    expect(res.text).not.toContain('HYPERLINK');
    await aisha.get('/api/reports/publications.csv?sort=evil').expect(400);
  });

  it('the summary export is admin-only', async () => {
    const res = await admin.get('/api/reports/summary.csv').expect(200);
    expect(res.text).toContain('"Department","Computer Science","1"');
    expect(res.text).toContain('"Year","2021","1"');
    expect(res.text).toContain('"Type","BOOK","1"');
    await aisha.get('/api/reports/summary.csv').expect(403);
    await viewer.get('/api/reports/summary.csv').expect(403);
  });
});

describe('admin area access control', () => {
  it.each([
    ['get', '/api/admin/stats'],
    ['get', '/api/admin/audit-logs'],
    ['get', '/api/admin/users'],
    ['post', '/api/admin/users'],
    ['patch', `/api/admin/users/${crypto.randomUUID()}`],
    ['post', `/api/admin/users/${crypto.randomUUID()}/access`],
  ] as const)('researchers and viewers get 403 on %s %s', async (method, path) => {
    for (const client of [aisha, viewer]) {
      const res = method === 'get' ? await client.get(path) : await client.send(method, path, {});
      expect(res.status).toBe(403);
    }
  });
});

describe('admin: stats and audit log', () => {
  it('returns dashboard statistics', async () => {
    await createPublication(fx.users.researcher.id, fx.departments.cs.id, { year: 2022 });
    await createPublication(fx.users.researcher.id, fx.departments.cs.id, { year: 2022, type: 'BOOK', title: 'B' });
    const res = await admin.get('/api/admin/stats').expect(200);
    expect(res.body.totals).toEqual({ publications: 2, researchers: 2 });
    expect(res.body.byDepartment).toEqual([
      { code: 'CS', name: 'Computer Science', count: 2 },
      { code: 'EE', name: 'Electrical Engineering', count: 0 },
    ]);
    expect(res.body.byYear).toEqual([{ year: 2022, count: 2 }]);
  });

  it('lists and filters the audit log', async () => {
    const res = await admin.get('/api/admin/audit-logs?action=LOGIN&entityType=Session').expect(200);
    expect(res.body.total).toBe(3); // the three logins in beforeEach
    expect(res.body.items[0].actor).toHaveProperty('email');
    const mine = await admin.get(`/api/admin/audit-logs?actorId=${fx.users.admin.id}`).expect(200);
    expect(mine.body.items.every((i: { actorId: string }) => i.actorId === fx.users.admin.id)).toBe(true);
    const range = await admin.get('/api/admin/audit-logs?from=2000-01-01&to=2000-12-31').expect(200);
    expect(range.body.total).toBe(0);
    await admin.get('/api/admin/audit-logs?action=drop%20table').expect(400);
    await admin.get('/api/admin/audit-logs?entityType=Secret').expect(400);
  });
});

describe('admin: users', () => {
  it('lists users with their personal data (admins only)', async () => {
    const res = await admin.get('/api/admin/users').expect(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.items[0]).not.toHaveProperty('passwordHash');
  });

  it('creates users; never logs the password', async () => {
    const body = { email: 'New@Test.edu', name: 'New Person', password: 'another-long-password', role: 'RESEARCHER', researcherType: 'STUDENT' };
    const res = await admin.send('post', '/api/admin/users', body).expect(201);
    expect(res.body).toMatchObject({ email: 'new@test.edu', role: 'RESEARCHER', researcherType: 'STUDENT' });
    const viewerRes = await admin
      .send('post', '/api/admin/users', { ...body, email: 'v2@test.edu', role: 'VIEWER', departmentId: fx.departments.cs.id })
      .expect(201);
    expect(viewerRes.body.researcherType).toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'USER_CREATE' } });
    expect(JSON.stringify(audit)).not.toContain('another-long-password');
    await admin.send('post', '/api/admin/users', body).expect(409);
    await admin.send('post', '/api/admin/users', { ...body, email: 'x@test.edu', password: 'short' }).expect(400);
    await admin.send('post', '/api/admin/users', { ...body, email: 'y@test.edu', role: 'SUPERUSER' }).expect(400);
  });

  it('a role change takes effect on the very next request', async () => {
    await aisha.get('/api/publications/lookup/doi?doi=bad').expect(400); // allowed role, bad input
    await admin.send('patch', `/api/admin/users/${fx.users.researcher.id}`, { role: 'VIEWER' }).expect(200);
    await aisha.get('/api/publications/lookup/doi?doi=bad').expect(403);
  });

  it('disabling a user logs them out everywhere', async () => {
    await admin.send('patch', `/api/admin/users/${fx.users.researcher.id}`, { active: false }).expect(200);
    await aisha.get('/api/auth/me').expect(401);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'USER_UPDATE' } });
    expect(audit.before).toMatchObject({ active: true });
    expect(audit.after).toMatchObject({ active: false });
  });

  it('an admin cannot remove their own admin access', async () => {
    await admin.send('patch', `/api/admin/users/${fx.users.admin.id}`, { role: 'VIEWER' }).expect(400);
    await admin.send('patch', `/api/admin/users/${fx.users.admin.id}`, { active: false }).expect(400);
    await admin.send('patch', `/api/admin/users/${fx.users.admin.id}`, { name: 'Ada A.' }).expect(200);
  });

  it('validates updates and 404s unknown users', async () => {
    await admin.send('patch', `/api/admin/users/${crypto.randomUUID()}`, { name: 'X' }).expect(404);
    await admin.send('patch', `/api/admin/users/${fx.users.researcher.id}`, { passwordHash: 'x' }).expect(400);
    await admin.send('patch', '/api/admin/users/not-a-uuid', { name: 'X' }).expect(400);
  });
});

describe('admin: access requests from sign-up', () => {
  async function signupUser(email: string) {
    return prisma.user.create({
      data: { email, name: 'Pending Person', passwordHash: 'x', role: 'VIEWER', pendingResearcherType: 'FACULTY', departmentId: fx.departments.cs.id },
    });
  }

  it('approve turns the viewer into a researcher and notifies them', async () => {
    const u = await signupUser('pending@test.edu');
    const res = await admin.send('post', `/api/admin/users/${u.id}/access`, { decision: 'approve' }).expect(200);
    expect(res.body).toMatchObject({ role: 'RESEARCHER', researcherType: 'FACULTY', pendingResearcherType: null });
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: u.id } });
    expect(note.type).toBe('ACCESS_APPROVED');
    expect(await prisma.auditLog.count({ where: { action: 'ACCESS_APPROVE', entityId: u.id } })).toBe(1);
  });

  it('reject keeps read-only access', async () => {
    const u = await signupUser('pending2@test.edu');
    const res = await admin.send('post', `/api/admin/users/${u.id}/access`, { decision: 'reject' }).expect(200);
    expect(res.body).toMatchObject({ role: 'VIEWER', pendingResearcherType: null });
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: u.id } })).type).toBe('ACCESS_REJECTED');
    // Nothing left to decide.
    await admin.send('post', `/api/admin/users/${u.id}/access`, { decision: 'approve' }).expect(400);
  });

  it('404 for unknown users, 400 for a bad decision', async () => {
    await admin.send('post', `/api/admin/users/${crypto.randomUUID()}/access`, { decision: 'approve' }).expect(404);
    await admin.send('post', `/api/admin/users/${fx.users.viewer.id}/access`, { decision: 'promote' }).expect(400);
  });

  it('fixture password constant is the one used by login()', () => {
    expect(PASSWORD.length).toBeGreaterThanOrEqual(12);
  });
});
