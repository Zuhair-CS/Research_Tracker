import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, prisma, resetDb, type Fixtures } from '../helpers/db.js';
import { anonymous, login } from '../helpers/http.js';

let fx: Fixtures;
beforeEach(async () => {
  fx = await resetDb();
});

const sessionCookie = (res: { headers: Record<string, unknown> }) =>
  ([] as string[]).concat((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith('pubtrack.sid='));

describe('login', () => {
  it('logs in with the right password and returns the profile and a new CSRF token', async () => {
    const client = await anonymous();
    const res = await client.send('post', '/api/auth/login', { email: 'AISHA@test.edu', password: PASSWORD }).expect(200);
    expect(res.body.user).toMatchObject({ email: 'aisha@test.edu', role: 'RESEARCHER', researcherType: 'FACULTY' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.csrfToken).not.toBe(client.csrf);

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    client.csrf = res.body.csrfToken;
    const me = await client.get('/api/auth/me').expect(200);
    expect(me.body.user.name).toBe('Aisha Rahman');
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN', actorId: fx.users.researcher.id } })).toBe(1);
  });

  it('issues a new session id at login (session fixation defence)', async () => {
    const client = await anonymous();
    const before = await client.get('/api/auth/csrf');
    const anonCookie = sessionCookie(before) ?? 'none-yet';
    const res = await client.send('post', '/api/auth/login', { email: 'aisha@test.edu', password: PASSWORD }).expect(200);
    const newCookie = sessionCookie(res);
    expect(newCookie).toBeDefined();
    expect(newCookie?.split(';')[0]).not.toBe(anonCookie.split(';')[0]);
  });

  it.each([
    ['wrong password', 'aisha@test.edu', 'not-the-password', 'wrong_password'],
    ['unknown e-mail', 'nobody@test.edu', PASSWORD, 'unknown_email'],
    ['disabled account', 'gone@test.edu', PASSWORD, 'account_disabled'],
  ])('gives one generic error for %s and audits the reason', async (_case, email, password, reason) => {
    const client = await anonymous();
    const res = await client.send('post', '/api/auth/login', { email, password }).expect(401);
    expect(res.body.error).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'LOGIN_FAILED' } });
    expect(audit?.after).toMatchObject({ email, reason });
  });

  it('validates the login body strictly', async () => {
    const client = await anonymous();
    await client.send('post', '/api/auth/login', { email: 'not-an-email', password: 'x' }).expect(400);
    const extra = await client.send('post', '/api/auth/login', { email: 'aisha@test.edu', password: PASSWORD, role: 'ADMIN' }).expect(400);
    expect(extra.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs out and destroys the session', async () => {
    const client = await login('aisha@test.edu');
    await client.send('post', '/api/auth/logout').expect(204);
    await client.get('/api/auth/me').expect(401);
    expect(await prisma.auditLog.count({ where: { action: 'LOGOUT' } })).toBe(1);
  });

  it('logout without a session is harmless', async () => {
    const client = await anonymous();
    await client.send('post', '/api/auth/logout').expect(204);
  });

  it('ends the session as soon as the account is disabled', async () => {
    const client = await login('aisha@test.edu');
    await prisma.user.update({ where: { id: fx.users.researcher.id }, data: { active: false } });
    await client.get('/api/auth/me').expect(401);
  });
});

describe('password change', () => {
  it('requires the current password and a different new one', async () => {
    const client = await login('aisha@test.edu');
    const wrong = await client.send('post', '/api/auth/password', { currentPassword: 'nope', newPassword: 'a-brand-new-password' }).expect(400);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    await client.send('post', '/api/auth/password', { currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
    await client.send('post', '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'short' }).expect(400);
  });

  it('changes the password and logs out every other session', async () => {
    const laptop = await login('aisha@test.edu');
    const phone = await login('aisha@test.edu');
    const res = await laptop.send('post', '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' }).expect(200);
    laptop.csrf = res.body.csrfToken;

    await laptop.get('/api/auth/me').expect(200); // this browser stays logged in
    await phone.get('/api/auth/me').expect(401); // the other session is gone

    const fresh = await anonymous();
    await fresh.send('post', '/api/auth/login', { email: 'aisha@test.edu', password: PASSWORD }).expect(401);
    await fresh.send('post', '/api/auth/login', { email: 'aisha@test.edu', password: 'a-brand-new-password' }).expect(200);
  });

  it('needs a session', async () => {
    const client = await anonymous();
    await client.send('post', '/api/auth/password', { currentPassword: 'x', newPassword: 'y'.repeat(12) }).expect(401);
  });
});

describe('sign-up', () => {
  const body = () => ({
    name: 'Dr. Gaurav Pandey',
    email: 'gaurav@upes.ac.in',
    password: 'a-long-enough-password',
    researcherType: 'FACULTY',
    departmentId: fx.departments.cs.id,
  });

  it('lists the options the form needs', async () => {
    const client = await anonymous();
    const res = await client.get('/api/auth/signup-options').expect(200);
    expect(res.body).toMatchObject({ enabled: true, allowedDomains: [] });
    expect(res.body.departments).toHaveLength(2);
  });

  it('creates a read-only VIEWER with a pending request, signs in and notifies admins', async () => {
    const client = await anonymous();
    const res = await client.send('post', '/api/auth/signup', body()).expect(201);
    expect(res.body.user).toMatchObject({ role: 'VIEWER', pendingResearcherType: 'FACULTY', researcherType: null });
    client.csrf = res.body.csrfToken;
    await client.get('/api/auth/me').expect(200);
    // Viewers cannot add publications until an admin approves.
    await client.send('post', '/api/publications', {}).expect(403);

    const notes = await prisma.notification.findMany({ where: { userId: fx.users.admin.id } });
    expect(notes.map((n) => n.type)).toEqual(['SIGNUP_PENDING']);
    expect(await prisma.auditLog.count({ where: { action: 'USER_SIGNUP' } })).toBe(1);
  });

  it('cannot be used to choose a role (mass assignment)', async () => {
    const client = await anonymous();
    const res = await client.send('post', '/api/auth/signup', { ...body(), role: 'ADMIN' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.user.count({ where: { email: 'gaurav@upes.ac.in' } })).toBe(0);
  });

  it('rejects duplicates, unknown departments and weak passwords; then rate-limits', async () => {
    const client = await anonymous();
    await client.send('post', '/api/auth/signup', { ...body(), email: 'aisha@test.edu' }).expect(409);
    const dept = await client.send('post', '/api/auth/signup', { ...body(), departmentId: crypto.randomUUID() }).expect(400);
    expect(dept.body.error.code).toBe('UNKNOWN_DEPARTMENT');
    await client.send('post', '/api/auth/signup', { ...body(), password: 'short' }).expect(400);

    // 5 sign-ups per IP per hour: keep going until the limiter answers 429.
    let status = 0;
    for (let i = 0; i < 6 && status !== 429; i++) {
      const res = await client.send('post', '/api/auth/signup', { ...body(), email: `spam${i}@test.edu` });
      status = res.status;
      if (res.body.csrfToken) client.csrf = res.body.csrfToken; // a sign-up starts a new session
    }
    expect(status).toBe(429);
  });
});

describe('login rate limit', () => {
  it('blocks an IP after LOGIN_RATE_LIMIT failed attempts (brute-force defence)', async () => {
    const client = await anonymous();
    for (let i = 0; i < 5; i++) {
      await client.send('post', '/api/auth/login', { email: 'aisha@test.edu', password: `guess-${i}` }).expect(401);
    }
    const blocked = await client.send('post', '/api/auth/login', { email: 'aisha@test.edu', password: PASSWORD }).expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
