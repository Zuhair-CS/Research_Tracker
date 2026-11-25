import { beforeEach, describe, expect, it } from 'vitest';
import { MAIN, installCatalog } from '../helpers/catalog.js';
import { OPENALEX, installFakeApis, when } from '../helpers/fake-apis.js';
import { prisma, resetDb, type Fixtures } from '../helpers/db.js';
import { loginAll, type Client } from '../helpers/http.js';

const apis = installFakeApis();
let fx: Fixtures;
let admin: Client, aisha: Client, bob: Client, viewer: Client;

beforeEach(async () => {
  apis.reset();
  installCatalog(apis);
  fx = await resetDb();
  [admin, aisha, bob, viewer] = await loginAll('admin@test.edu', 'aisha@test.edu', 'bob@test.edu', 'viewer@test.edu');
});

const wholeProfile = () => ({ researcherId: fx.users.researcher.id, openalexAuthorId: MAIN, authorName: 'Aisha Rahman', authorInstitution: 'UPES' });

async function sendClaim(body: object = wholeProfile()) {
  const res = await admin.send('post', '/api/claims', body).expect(201);
  return res.body as { id: string; works: { key: string; title: string }[] };
}

describe('creating a request (admin)', () => {
  it('sends the whole profile; the researcher is notified; audited', async () => {
    const claim = await sendClaim({ ...wholeProfile(), message: 'Are these yours?' });
    expect(claim.works.map((w) => w.title)).toEqual(['Deep learning for crop yield prediction', 'Soil moisture sensing at scale']);
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: fx.users.researcher.id } });
    expect(note).toMatchObject({ type: 'CLAIM_REQUEST', link: `/claims/${claim.id}` });
    expect(note.message).toContain('2 paper(s) under "Aisha Rahman"');
    expect(await prisma.auditLog.count({ where: { action: 'CLAIM_REQUEST', entityId: claim.id } })).toBe(1);
  });

  it('can include other profiles of the same person plus ticked extra papers', async () => {
    const claim = await sendClaim({ ...wholeProfile(), alsoAuthorIds: ['A1000002'], wholeProfile: true, works: [{ doi: '10.5555/c2' }, { openalexId: 'W1001' }] });
    // Ticked papers first, then the profiles; W1001 is not repeated.
    expect(claim.works.map((w) => w.key)).toEqual(['W1001', 'doi:10.5555/c2', 'W1002', 'W2001']);
  });

  it('can send only selected papers, re-fetched from the source (titles from the browser are ignored)', async () => {
    const claim = await sendClaim({ researcherId: fx.users.researcher.id, authorName: 'Selected papers', works: [{ openalexId: 'W3001', title: 'Fake' }] }).catch(() => null);
    expect(claim).toBeNull(); // unknown field "title" is rejected outright
    const ok = await sendClaim({ researcherId: fx.users.researcher.id, authorName: 'Selected papers', works: [{ openalexId: 'W3001' }, { doi: '10.5555/nope' }] });
    expect(ok.works.map((w) => w.title)).toEqual(['Crop yield datasets for South Asia']);
  });

  it('only admins can send requests', async () => {
    await aisha.send('post', '/api/claims', wholeProfile()).expect(403);
    await viewer.send('post', '/api/claims', wholeProfile()).expect(403);
  });

  it('only to an active researcher account', async () => {
    for (const id of [fx.users.viewer.id, fx.users.disabled.id, fx.users.admin.id, crypto.randomUUID()]) {
      const res = await admin.send('post', '/api/claims', { ...wholeProfile(), researcherId: id }).expect(400);
      expect(res.body.error.code).toBe('INVALID_RESEARCHER');
    }
  });

  it('refuses duplicates and profiles already confirmed by someone else', async () => {
    await sendClaim();
    await admin.send('post', '/api/claims', wholeProfile()).expect(409);
    await prisma.user.update({ where: { id: fx.users.other.id }, data: { openalexAuthorId: 'A1000002' } });
    const taken = await admin.send('post', '/api/claims', { ...wholeProfile(), openalexAuthorId: 'A1000002' }).expect(409);
    expect(taken.body.error.message).toContain('Bob Kumar');
  });

  it('validates the request', async () => {
    const base = { researcherId: fx.users.researcher.id, authorName: 'X' };
    await admin.send('post', '/api/claims', base).expect(400); // nothing to send
    await admin.send('post', '/api/claims', { ...base, alsoAuthorIds: ['A1000002'], works: [{ openalexId: 'W1001' }] }).expect(400);
    await admin.send('post', '/api/claims', { ...base, openalexAuthorId: 'A1;DROP' }).expect(400);
    await admin.send('post', '/api/claims', { ...base, works: [{ doi: '10.5555/nope' }] }).expect(400); // nothing found
  });
});

describe('who can see a request', () => {
  it('admins see all, researchers only their own, others get 404 (not 403)', async () => {
    const claim = await sendClaim();
    expect((await admin.get('/api/claims').expect(200)).body.items).toHaveLength(1);
    expect((await aisha.get('/api/claims').expect(200)).body.items).toHaveLength(1);
    expect((await bob.get('/api/claims').expect(200)).body.items).toHaveLength(0);
    expect((await admin.get('/api/claims?status=APPROVED').expect(200)).body.items).toHaveLength(0);
    await viewer.get('/api/claims').expect(403);

    const mine = await aisha.get(`/api/claims/${claim.id}`).expect(200);
    expect(mine.body.works).toHaveLength(2);
    expect(mine.body.researcher).toMatchObject({ name: 'Aisha Rahman' });
    await bob.get(`/api/claims/${claim.id}`).expect(404);
    await admin.get(`/api/claims/${crypto.randomUUID()}`).expect(404);
  });
});

describe('approving', () => {
  it('imports only the ticked papers, links the profile and tells the admin', async () => {
    const claim = await sendClaim();
    const res = await aisha.send('post', `/api/claims/${claim.id}/approve`, { keys: ['W1001'] }).expect(200);
    expect(res.body.imported.map((p: { title: string }) => p.title)).toEqual(['Deep learning for crop yield prediction']);

    const saved = await prisma.claimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(saved).toMatchObject({ status: 'APPROVED', importedCount: 1 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fx.users.researcher.id } })).openalexAuthorId).toBe(MAIN);
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: fx.users.admin.id, type: 'CLAIM_APPROVED' } });
    expect(note.message).toContain('1 paper(s) added');

    // The detail view now marks it as imported; a second approval is refused.
    const view = await aisha.get(`/api/claims/${claim.id}`).expect(200);
    expect(view.body.works.map((w: { alreadyImported: boolean }) => w.alreadyImported)).toEqual([true, false]);
    await aisha.send('post', `/api/claims/${claim.id}/approve`, {}).expect(409);
  });

  it('only the named researcher can approve', async () => {
    const claim = await sendClaim();
    await bob.send('post', `/api/claims/${claim.id}/approve`, {}).expect(404);
    await admin.send('post', `/api/claims/${claim.id}/approve`, {}).expect(403);
    await viewer.send('post', `/api/claims/${claim.id}/approve`, {}).expect(403);
    expect((await prisma.claimRequest.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe('PENDING');
  });

  it('needs at least one ticked paper and a valid department', async () => {
    const claim = await sendClaim();
    await aisha.send('post', `/api/claims/${claim.id}/approve`, { keys: [] }).expect(400);
    await aisha.send('post', `/api/claims/${claim.id}/approve`, { departmentId: crypto.randomUUID() }).expect(400);
    await prisma.user.update({ where: { id: fx.users.researcher.id }, data: { departmentId: null } });
    await aisha.send('post', `/api/claims/${claim.id}/approve`, {}).expect(400);
  });

  it('puts the request back to PENDING if the import fails', async () => {
    const claim = await sendClaim();
    apis.on(when(OPENALEX, '/works', { status: 500 }, (u) => Boolean(u.searchParams.get('filter')?.startsWith('ids.openalex'))));
    await aisha.send('post', `/api/claims/${claim.id}/approve`, {}).expect(502);
    expect((await prisma.claimRequest.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe('PENDING');
    expect(await prisma.publication.count()).toBe(0);
  });

  it('keeps an existing profile link', async () => {
    await prisma.user.update({ where: { id: fx.users.researcher.id }, data: { openalexAuthorId: 'A1000004' } });
    const claim = await sendClaim();
    await aisha.send('post', `/api/claims/${claim.id}/approve`, {}).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fx.users.researcher.id } })).openalexAuthorId).toBe('A1000004');
  });
});

describe('rejecting and withdrawing', () => {
  it('the researcher can say "not me", with a note for the admin', async () => {
    const claim = await sendClaim();
    await bob.send('post', `/api/claims/${claim.id}/reject`, {}).expect(404);
    await aisha.send('post', `/api/claims/${claim.id}/reject`, { note: 'Different Aisha' }).expect(204);
    const saved = await prisma.claimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(saved).toMatchObject({ status: 'REJECTED', responseNote: 'Different Aisha' });
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: fx.users.admin.id, type: 'CLAIM_REJECTED' } });
    expect(note.message).toContain('Different Aisha');
    await aisha.send('post', `/api/claims/${claim.id}/reject`, {}).expect(409);
    await aisha.send('post', `/api/claims/${claim.id}/approve`, {}).expect(409);
  });

  it('the admin can withdraw a waiting request; the researcher is told', async () => {
    const claim = await sendClaim();
    await aisha.send('post', `/api/claims/${claim.id}/cancel`).expect(403);
    await admin.send('post', `/api/claims/${claim.id}/cancel`).expect(204);
    expect((await prisma.notification.findMany({ where: { userId: fx.users.researcher.id } })).map((n) => n.type)).toEqual(
      expect.arrayContaining(['CLAIM_CANCELLED']),
    );
    await admin.send('post', `/api/claims/${claim.id}/cancel`).expect(409);
    await admin.send('post', `/api/claims/${crypto.randomUUID()}/cancel`).expect(404);
    await aisha.send('post', `/api/claims/${claim.id}/approve`, {}).expect(409);
  });
});
