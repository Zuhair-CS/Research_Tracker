import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../src/config/env.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { HttpError } from '../../src/lib/errors.js';
import { apiNotFound, errorHandler } from '../../src/middleware/error-handler.js';
import { canModify, buildWhere } from '../../src/services/publications.js';
import type { AuthUser } from '../../src/types/express.js';

const valid = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', SESSION_SECRET: 'x'.repeat(32) };

describe('configuration (fail closed)', () => {
  it('applies safe defaults', () => {
    const c = loadConfig(valid);
    expect(c).toMatchObject({ NODE_ENV: 'development', PORT: 3000, COOKIE_SECURE: true, TRUST_PROXY: 0, CORS_ORIGINS: [], SIGNUP_ENABLED: true, LOGIN_RATE_LIMIT: 10 });
    expect(c.OPENALEX_API_KEY).toBeUndefined();
  });

  it('parses lists and treats blank optional values as unset', () => {
    const c = loadConfig({
      ...valid,
      CORS_ORIGINS: 'http://a.test, http://b.test',
      INSTITUTION_ALIASES: 'UPES, ,University X',
      SIGNUP_ALLOWED_DOMAINS: '@UPES.ac.in,stu.upes.ac.in',
      OPENALEX_API_KEY: '',
      API_CONTACT_EMAIL: '',
    });
    expect(c.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(c.INSTITUTION_ALIASES).toEqual(['UPES', 'University X']);
    expect(c.SIGNUP_ALLOWED_DOMAINS).toEqual(['upes.ac.in', 'stu.upes.ac.in']);
    expect(c.OPENALEX_API_KEY).toBeUndefined();
  });

  it.each([
    ['a missing database URL', { SESSION_SECRET: 'x'.repeat(32) }, 'DATABASE_URL'],
    ['a short session secret', { ...valid, SESSION_SECRET: 'short' }, 'SESSION_SECRET'],
    ['insecure cookies in production', { ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' }, 'COOKIE_SECURE must be true in production'],
    ['a bad CORS origin', { ...valid, CORS_ORIGINS: 'not a url' }, 'CORS_ORIGINS'],
    ['a malformed institution id', { ...valid, OPENALEX_INSTITUTION_ID: 'UPES' }, 'OPENALEX_INSTITUTION_ID'],
    ['a non-boolean flag', { ...valid, SIGNUP_ENABLED: 'yes' }, 'SIGNUP_ENABLED'],
  ])('refuses to start with %s', (_case, env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });

  it('never prints secret values in the error', () => {
    try {
      loadConfig({ ...valid, SESSION_SECRET: 'super-secret-but-short' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret-but-short');
    }
  });
});

/** A minimal stand-in for Express's Response that records what the handler sent. */
function fakeRes() {
  const sent = { statusCode: 0, body: undefined as unknown };
  const res = {
    status: vi.fn((code: number) => {
      sent.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      sent.body = body;
      return res;
    }),
  };
  // Live getters, so assertions see what the handler sent after it ran.
  Object.defineProperties(res, {
    statusCode: { get: () => sent.statusCode },
    body: { get: () => sent.body },
  });
  return res as unknown as Response & { body: unknown };
}
const req = { path: '/api/x', method: 'GET' } as Request;

describe('error handler (no information leakage)', () => {
  it('turns validation errors into 400 with field details', () => {
    const res = fakeRes();
    const err = z.object({ year: z.number() }).safeParse({ year: 'x' }).error;
    errorHandler(err, req, res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR', details: [{ path: 'year' }] } });
  });

  it('passes HttpErrors through', () => {
    const res = fakeRes();
    errorHandler(new HttpError(418, 'TEAPOT', 'short and stout'), req, res, vi.fn());
    expect(res.statusCode).toBe(418);
    expect(res.body).toEqual({ error: { code: 'TEAPOT', message: 'short and stout' } });
  });

  it.each([
    ['P2002', 409, 'CONFLICT'],
    ['P2025', 404, 'NOT_FOUND'],
    ['P2003', 500, 'INTERNAL_ERROR'],
  ])('maps Prisma error %s to %i', (code, status, expected) => {
    const res = fakeRes();
    const err = new Prisma.PrismaClientKnownRequestError('db says no: SELECT * FROM "User"', { code, clientVersion: 'test' });
    errorHandler(err, req, res, vi.fn());
    expect(res.statusCode).toBe(status);
    expect((res.body as { error: { code: string } }).error.code).toBe(expected);
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
  });

  it('exposes only safe 4xx errors from Express itself', () => {
    const res = fakeRes();
    errorHandler(Object.assign(new Error('request entity too large'), { status: 413, expose: true }), req, res, vi.fn());
    expect(res.statusCode).toBe(413);
  });

  it('hides everything about unexpected errors', () => {
    const res = fakeRes();
    errorHandler(new Error('ECONNREFUSED 10.0.0.5:5432 at /app/dist/lib/db.js'), req, res, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    const hidden = fakeRes();
    errorHandler(Object.assign(new Error('secret'), { status: 400, expose: false }), req, hidden, vi.fn());
    expect(hidden.statusCode).toBe(500);
  });

  it('answers unknown API routes with 404 JSON', () => {
    const res = fakeRes();
    apiNotFound(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('publication access rules', () => {
  const user = (role: AuthUser['role'], id = 'u1') => ({ id, role }) as AuthUser;
  it.each([
    ['ADMIN', 'someone-else', true],
    ['RESEARCHER', 'u1', true],
    ['RESEARCHER', 'someone-else', false],
    ['VIEWER', 'u1', false],
  ] as const)('%s may modify a record owned by %s: %s', (role, ownerId, expected) => {
    expect(canModify(user(role), { ownerId })).toBe(expected);
  });

  it('builds no filter for an empty query and an AND of every filter otherwise', () => {
    const base = { mine: false, sort: 'year_desc', page: 1, pageSize: 20 } as const;
    expect(buildWhere(base, user('VIEWER'))).toEqual({});
    const where = buildWhere({ ...base, q: 'x', author: 'y', type: 'BOOK', year: 2020, yearFrom: 2019, yearTo: 2021, mine: true, departmentId: 'd' }, user('RESEARCHER'));
    expect((where.AND as unknown[]).length).toBe(8);
  });
});
