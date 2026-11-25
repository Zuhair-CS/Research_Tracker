import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

/**
 * Tests run against a SEPARATE database whose name ends in "_test"
 * (e.g. pubtrack_test). Integration tests wipe it before every test file,
 * so it must never be the development or production database:
 *  - TEST_DATABASE_URL is used if set (CI sets it to its own Postgres service);
 *  - otherwise the dev DATABASE_URL is taken and "_test" is added to its name.
 * test/global-setup.ts refuses to run against a name without "_test".
 */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const fromFile = existsSync('../../.env') ? parseEnv(readFileSync('../../.env', 'utf8')).DATABASE_URL : undefined;
  const base = process.env.DATABASE_URL ?? fromFile;
  if (!base) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) to run the tests');
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  return url.toString();
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Each test file runs in its own process (fresh config, rate-limit counters
    // and DB pool), one file at a time because they share the test database.
    pool: 'forks',
    isolate: true,
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Fixed, fake settings: tests never see real secrets (e.g. the OpenAlex key)
    // and never call real external APIs (fetch is mocked in every test).
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl(),
      SESSION_SECRET: 'test-only-session-secret-not-used-anywhere-else',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      LOG_LEVEL: 'silent',
      CORS_ORIGINS: 'http://localhost:5173',
      CROSSREF_API_BASE: 'https://api.crossref.org',
      ORCID_API_BASE: 'https://pub.orcid.org/v3.0',
      OPENALEX_API_BASE: 'https://api.openalex.org',
      OPENALEX_API_KEY: '',
      OPENALEX_INSTITUTION_ID: 'I5847235',
      INSTITUTION_ALIASES: 'UPES,University of Petroleum and Energy Studies',
      API_CONTACT_EMAIL: '',
      SIGNUP_ENABLED: 'true',
      SIGNUP_ALLOWED_DOMAINS: '',
      LOGIN_RATE_LIMIT: '5',
      WEB_DIST_DIR: '',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Generated Prisma client, type declarations and the process entry point.
      exclude: ['src/generated/**', 'src/types/**', 'src/server.ts', 'src/services/scholarly-types.ts'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      // Quality gate: the pipeline fails if backend coverage drops below 80%.
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
