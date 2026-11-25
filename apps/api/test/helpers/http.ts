import type { Express } from 'express';
import request from 'supertest';
import { PASSWORD } from './db.js';

let app: Express | undefined;

/** The Express app, created once per test file (after the env for that file is set). */
export async function getApp(): Promise<Express> {
  if (!app) {
    const { createApp } = await import('../../src/app.js');
    app = createApp();
  }
  return app;
}

/**
 * A logged-in browser: a cookie-keeping supertest agent plus its CSRF token.
 * `send(method, path, body)` adds the CSRF header like the React app does.
 */
export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  get: (path: string) => request.Test;
  send: (method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: object) => request.Test;
}

export async function anonymous(): Promise<Client> {
  const agent = request.agent(await getApp());
  const res = await agent.get('/api/auth/csrf').expect(200);
  return makeClient(agent, res.body.csrfToken as string);
}

export async function login(email: string, password = PASSWORD): Promise<Client> {
  const client = await anonymous();
  const res = await client.send('post', '/api/auth/login', { email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  client.csrf = res.body.csrfToken as string;
  return client;
}

/** Log several fixture users in at once: `const [admin, viewer] = await loginAll('admin@…', 'viewer@…')`. */
export async function loginAll<const T extends readonly string[]>(...emails: T): Promise<{ [K in keyof T]: Client }> {
  return (await Promise.all(emails.map((e) => login(e)))) as { [K in keyof T]: Client };
}

/**
 * All requests in a test come from localhost, so failed logins from one test
 * would count against the next. Clear the login / sign-up counters between tests.
 */
export async function resetRateLimits(): Promise<void> {
  const { loginLimiter, signupLimiter } = await import('../../src/middleware/rate-limit.js');
  for (const key of ['127.0.0.1', '::1', '::/56', '::ffff:127.0.0.1']) {
    await loginLimiter.resetKey(key);
    await signupLimiter.resetKey(key);
  }
}

function makeClient(agent: ReturnType<typeof request.agent>, csrf: string): Client {
  const client: Client = {
    agent,
    csrf,
    get: (path) => agent.get(path),
    send: (method, path, body) => {
      const req = agent[method](path).set('X-CSRF-Token', client.csrf);
      return body ? req.send(body) : req;
    },
  };
  return client;
}
