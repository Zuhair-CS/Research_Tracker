import { describe, expect, it, vi } from 'vitest';

// Configuration is read once when the app starts, so set it before anything is imported.
vi.hoisted(() => {
  process.env.SIGNUP_ALLOWED_DOMAINS = 'upes.ac.in, @stu.upes.ac.in';
});

const { resetDb } = await import('../helpers/db.js');
const { anonymous } = await import('../helpers/http.js');

describe('sign-up domain allow-list', () => {
  it('only accepts university e-mail domains', async () => {
    const fx = await resetDb();
    const client = await anonymous();
    const options = await client.get('/api/auth/signup-options').expect(200);
    expect(options.body.allowedDomains).toEqual(['upes.ac.in', 'stu.upes.ac.in']);

    const body = { name: 'Some One', password: 'a-long-enough-password', researcherType: 'STUDENT', departmentId: fx.departments.cs.id };
    const res = await client.send('post', '/api/auth/signup', { ...body, email: 'someone@gmail.com' }).expect(400);
    expect(res.body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    await client.send('post', '/api/auth/signup', { ...body, email: 'someone@stu.upes.ac.in' }).expect(201);
  });
});

describe('sign-up switched off', () => {
  it('refuses all sign-ups', async () => {
    vi.resetModules();
    process.env.SIGNUP_ENABLED = 'false';
    const { anonymous: anon } = await import('../helpers/http.js');
    const client = await anon();
    const res = await client.send('post', '/api/auth/signup', {}).expect(403);
    expect(res.body.error.code).toBe('SIGNUP_DISABLED');
  });
});
