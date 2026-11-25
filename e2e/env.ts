import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Settings for the end-to-end run. Everything is fake and local:
 *  - its own database (<dev name>_e2e), wiped and seeded before each run;
 *  - Crossref / ORCID / OpenAlex point at the mock server in e2e/mock-apis.mjs;
 *  - test-only passwords and session secret.
 */
const root = path.resolve(__dirname, '..');

function e2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const envFile = path.join(root, '.env');
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL : undefined;
  const base = process.env.DATABASE_URL ?? fromFile;
  if (!base) throw new Error('Set E2E_DATABASE_URL (or DATABASE_URL) to run the end-to-end tests');
  const url = new URL(base);
  url.pathname = `/${url.pathname.replace(/^\//, '').replace(/_test$/, '')}_e2e`;
  return url.toString();
}

export const APP_PORT = 3100;
export const MOCK_PORT = 4010;
export const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

export const ACCOUNTS = {
  admin: { email: 'admin@e2e.test', password: 'e2e-admin-password-1' },
  researcher: { email: 'aisha@e2e.test', password: 'e2e-researcher-password-1' },
  viewer: { email: 'viewer@e2e.test', password: 'e2e-viewer-password-1' },
} as const;

export const serverEnv: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: String(APP_PORT),
  DATABASE_URL: e2eDatabaseUrl(),
  SESSION_SECRET: 'e2e-only-session-secret-not-used-anywhere-else',
  COOKIE_SECURE: 'false',
  TRUST_PROXY: '0',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: '',
  WEB_DIST_DIR: path.join(root, 'apps', 'web', 'dist'),
  CROSSREF_API_BASE: `${MOCK}/crossref`,
  ORCID_API_BASE: `${MOCK}/orcid`,
  OPENALEX_API_BASE: `${MOCK}/openalex`,
  OPENALEX_API_KEY: '',
  OPENALEX_INSTITUTION_ID: 'I5847235',
  API_CONTACT_EMAIL: '',
  SIGNUP_ENABLED: 'true',
  SIGNUP_ALLOWED_DOMAINS: '',
  LOGIN_RATE_LIMIT: '100',
  SEED_ADMIN_EMAIL: ACCOUNTS.admin.email,
  SEED_ADMIN_PASSWORD: ACCOUNTS.admin.password,
  SEED_RESEARCHER_EMAIL: ACCOUNTS.researcher.email,
  SEED_RESEARCHER_PASSWORD: ACCOUNTS.researcher.password,
  SEED_VIEWER_EMAIL: ACCOUNTS.viewer.email,
  SEED_VIEWER_PASSWORD: ACCOUNTS.viewer.password,
};
