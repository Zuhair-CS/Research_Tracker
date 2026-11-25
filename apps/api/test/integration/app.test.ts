import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { resetDb } from '../helpers/db.js';
import { anonymous, getApp, login } from '../helpers/http.js';

/** Cross-cutting behaviour of the whole API: health, headers, CORS, CSRF, deny-by-default, error handling. */
describe('app', () => {
  beforeAll(async () => {
    await resetDb();
  });

  it('reports health and readiness without revealing details', async () => {
    const app = await getApp();
    const live = await request(app).get('/api/health').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
    const ready = await request(app).get('/api/health/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ready' });
  });

  it('sends the security headers on every response', async () => {
    const res = await request(await getApp()).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('allows CORS only for listed origins', async () => {
    const app = await getApp();
    const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    ['get', '/api/departments'],
    ['get', '/api/publications'],
    ['get', '/api/orcid/works'],
    ['get', '/api/discover/config'],
    ['get', '/api/claims'],
    ['get', '/api/notifications'],
    ['get', '/api/reports/publications.csv'],
    ['get', '/api/admin/stats'],
    ['get', '/api/auth/me'],
    ['get', '/api/unknown-route'],
  ] as const)('denies %s %s without a session (401)', async (method, path) => {
    const res = await request(await getApp())[method](path).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects state-changing requests without a valid CSRF token', async () => {
    const app = await getApp();
    const noToken = await request(app).post('/api/auth/login').send({ email: 'admin@test.edu', password: 'x' }).expect(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');

    const client = await anonymous();
    const wrong = await client.agent.post('/api/auth/login').set('X-CSRF-Token', 'not-the-token').send({}).expect(403);
    expect(wrong.body.error.code).toBe('CSRF_INVALID');
    const shorter = await client.agent.post('/api/auth/login').set('X-CSRF-Token', 'x').send({});
    expect(shorter.status).toBe(403);
  });

  it('returns 404 JSON for unknown API routes once logged in', async () => {
    const admin = await login('admin@test.edu');
    const res = await admin.get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('lists departments for any logged-in user', async () => {
    const viewer = await login('viewer@test.edu');
    const res = await viewer.get('/api/departments').expect(200);
    expect(res.body.items.map((d: { code: string }) => d.code)).toEqual(['CS', 'EE']);
  });

  it('answers malformed JSON and oversized bodies with 4xx, never 500', async () => {
    const client = await anonymous();
    const bad = await client.agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', client.csrf)
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');

    const huge = await client.send('post', '/api/auth/login', { email: 'a@b.co', password: 'x'.repeat(200_000) });
    expect(huge.status).toBe(413);
  });
});
