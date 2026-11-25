import { beforeEach, describe, expect, it } from 'vitest';
import { ORCID, installFakeApis, when } from '../helpers/fake-apis.js';
import { createPublication, prisma, resetDb, type Fixtures } from '../helpers/db.js';
import { loginAll, type Client } from '../helpers/http.js';

const apis = installFakeApis();
let fx: Fixtures;
let admin: Client, aisha: Client, bob: Client, viewer: Client;

const MY_ORCID = '0000-0002-1825-0097';
const OTHER_ORCID = '0000-0002-1694-233X';

const summary = (putCode: number, title: string, year: string | null, doi?: string) => ({
  'put-code': putCode,
  title: { title: { value: title } },
  type: 'journal-article',
  'publication-date': year ? { year: { value: year } } : null,
  'journal-title': { value: 'ORCID Journal' },
  'external-ids': doi ? { 'external-id': [{ 'external-id-type': 'doi', 'external-id-value': doi, 'external-id-relationship': 'self' }] } : null,
});
const WORKS = [summary(101, 'First <i>ORCID</i> paper', '2022', '10.5555/O1'), summary(102, 'Second paper', '2023'), summary(103, 'Undated note', null)];

beforeEach(async () => {
  apis.reset();
  fx = await resetDb();
  [admin, aisha, bob, viewer] = await loginAll('admin@test.edu', 'aisha@test.edu', 'bob@test.edu', 'viewer@test.edu');
  // Summaries: /v3.0/{id}/works ; bulk details: /v3.0/{id}/works/101,102
  apis.on(when(ORCID, `/v3.0/${MY_ORCID}/works`, { body: { group: WORKS.map((w) => ({ 'work-summary': [w] })) } }));
  apis.on(
    when(ORCID, `/v3.0/${MY_ORCID}/works/`, (url) => {
      const codes = url.pathname.split('/').pop()?.split(',') ?? [];
      return {
        body: {
          bulk: codes.map((c) => {
            const w = WORKS.find((x) => String(x['put-code']) === c);
            return w ? { work: { ...w, contributors: { contributor: [{ 'credit-name': { value: 'Aisha Rahman' } }, { 'credit-name': { value: 'Co Author' } }] } } } : { error: {} };
          }),
        },
      };
    }),
  );
  apis.on(when(ORCID, `/v3.0/${OTHER_ORCID}/works`, { status: 404 }));
});

describe('ORCID link and import (researchers only)', () => {
  it('links a valid, existing iD and audits it; can unlink', async () => {
    const res = await aisha.send('put', '/api/orcid', { orcidId: `https://orcid.org/${MY_ORCID}` }).expect(200);
    expect(res.body).toEqual({ orcidId: MY_ORCID });
    expect(apis.calls[0]?.href).toBe(`https://pub.orcid.org/v3.0/${MY_ORCID}/works`);
    expect((await aisha.get('/api/auth/me')).body.user.orcidId).toBe(MY_ORCID);
    await aisha.send('delete', '/api/orcid').expect(204);
    expect((await aisha.get('/api/auth/me')).body.user.orcidId).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: { in: ['ORCID_LINK', 'ORCID_UNLINK'] } } })).toBe(2);
  });

  it('rejects bad check digits, unknown records and iDs taken by someone else', async () => {
    await aisha.send('put', '/api/orcid', { orcidId: '0000-0002-1825-0098' }).expect(400);
    await aisha.send('put', '/api/orcid', { orcidId: '../../etc/passwd' }).expect(400);
    await aisha.send('put', '/api/orcid', { orcidId: OTHER_ORCID }).expect(404);
    await prisma.user.update({ where: { id: fx.users.other.id }, data: { orcidId: MY_ORCID } });
    await aisha.send('put', '/api/orcid', { orcidId: MY_ORCID }).expect(409);
  });

  it('admins and viewers cannot use ORCID import', async () => {
    for (const client of [admin, viewer]) {
      await client.get('/api/orcid/works').expect(403);
      await client.send('put', '/api/orcid', { orcidId: MY_ORCID }).expect(403);
    }
  });

  it('needs a linked iD before previewing or importing', async () => {
    const res = await aisha.get('/api/orcid/works').expect(400);
    expect(res.body.error.code).toBe('ORCID_NOT_LINKED');
    await aisha.send('post', '/api/orcid/import', { putCodes: ['101'] }).expect(400);
  });

  it('previews works, imports the selected ones and skips duplicates and undated items', async () => {
    await aisha.send('put', '/api/orcid', { orcidId: MY_ORCID }).expect(200);
    await createPublication(fx.users.researcher.id, fx.departments.cs.id, { doi: '10.5555/o1' });

    const preview = await aisha.get('/api/orcid/works').expect(200);
    expect(preview.body.works.map((w: { title: string; alreadyImported: boolean }) => [w.title, w.alreadyImported])).toEqual([
      ['First ORCID paper', true], // HTML tags stripped; DOI already in the account
      ['Second paper', false],
      ['Undated note', false],
    ]);

    const res = await aisha.send('post', '/api/orcid/import', { putCodes: ['101', '102', '103', '102', '999'] }).expect(200);
    expect(res.body.imported.map((p: { title: string; authors: string[] }) => [p.title, p.authors])).toEqual([['Second paper', ['Aisha Rahman', 'Co Author']]]);
    expect(res.body.skipped.map((s: { reason: string }) => s.reason)).toEqual(['Already in your publications', 'Missing title or valid year on ORCID']);
    // The bulk call asked for each put-code once.
    expect(apis.calls.at(-1)?.pathname).toBe(`/v3.0/${MY_ORCID}/works/101,102,103,999`);

    const again = await aisha.send('post', '/api/orcid/import', { putCodes: ['102'] }).expect(200);
    expect(again.body.skipped[0].reason).toBe('Already in your publications');
    expect(await prisma.auditLog.count({ where: { action: 'ORCID_IMPORT' } })).toBe(2);
  });

  it('validates put-codes and the department', async () => {
    await aisha.send('put', '/api/orcid', { orcidId: MY_ORCID }).expect(200);
    await aisha.send('post', '/api/orcid/import', { putCodes: ['1,2'] }).expect(400);
    await aisha.send('post', '/api/orcid/import', { putCodes: [] }).expect(400);
    await aisha.send('post', '/api/orcid/import', { putCodes: ['101'], departmentId: crypto.randomUUID() }).expect(400);
    await prisma.user.update({ where: { id: fx.users.researcher.id }, data: { departmentId: null } });
    await aisha.send('post', '/api/orcid/import', { putCodes: ['101'] }).expect(400);
  });
});

describe('notifications (private to each user)', () => {
  it('lists, counts and marks as read only my own notifications', async () => {
    const [mine] = await Promise.all([
      prisma.notification.create({ data: { userId: fx.users.researcher.id, type: 'CLAIM_REQUEST', message: 'For Aisha' } }),
      prisma.notification.create({ data: { userId: fx.users.researcher.id, type: 'ACCESS_APPROVED', message: 'Also for Aisha' } }),
    ]);
    const bobs = await prisma.notification.create({ data: { userId: fx.users.other.id, type: 'CLAIM_REQUEST', message: 'For Bob' } });

    const list = await aisha.get('/api/notifications').expect(200);
    expect(list.body.unread).toBe(2);
    expect(list.body.items.map((n: { message: string }) => n.message).sort()).toEqual(['Also for Aisha', 'For Aisha']);

    await aisha.send('post', `/api/notifications/${mine.id}/read`).expect(204);
    await aisha.send('post', `/api/notifications/${mine.id}/read`).expect(204); // already read: still fine
    expect((await aisha.get('/api/notifications/unread-count')).body).toEqual({ unread: 1 });

    // Someone else's notification looks like it does not exist.
    await aisha.send('post', `/api/notifications/${bobs.id}/read`).expect(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: bobs.id } })).readAt).toBeNull();

    await aisha.send('post', '/api/notifications/read-all').expect(204);
    expect((await aisha.get('/api/notifications/unread-count')).body).toEqual({ unread: 0 });
    expect((await bob.get('/api/notifications/unread-count')).body).toEqual({ unread: 1 });
  });
});
