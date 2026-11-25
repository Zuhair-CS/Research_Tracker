import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// Serve a tiny fake React build, as the production image does. The folder is
// created before the app's configuration is loaded (vi.hoisted runs first).
const dir = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const d = fs.mkdtempSync(`${os.tmpdir()}/web-`);
  process.env.WEB_DIST_DIR = d;
  process.env.TRUST_PROXY = '1';
  return d;
});
mkdirSync(path.join(dir, 'assets'), { recursive: true });
writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
writeFileSync(path.join(dir, '.env'), 'SECRET=1');

const { getApp } = await import('../helpers/http.js');
const { prisma } = await import('../../src/lib/db.js');

describe('serving the React app', () => {
  it('serves index.html for app routes (client-side routing)', async () => {
    const res = await request(await getApp()).get('/publications/new').expect(200);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('serves hashed assets with long caching', async () => {
    const res = await request(await getApp()).get('/assets/app-abc123.js').expect(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('never serves dot-files such as .env', async () => {
    const res = await request(await getApp()).get('/.env');
    expect(res.text).not.toContain('SECRET');
  });

  it('API 404s stay JSON', async () => {
    const res = await request(await getApp()).get('/api/health/nope');
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('readiness reports 503 when the database is down', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(await getApp()).get('/api/health/ready').expect(503);
    expect(res.body).toEqual({ status: 'unavailable' });
    spy.mockRestore();
  });
});
