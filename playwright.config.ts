import { defineConfig, devices } from '@playwright/test';
import { APP_PORT, MOCK_PORT, serverEnv } from './e2e/env';

/**
 * End-to-end tests: a real browser drives the built React app, served by the
 * real API, on a freshly seeded database. External APIs are mocked.
 * Run with: npm run test:e2e   (Postgres must be running: npm run db:up)
 */
export default defineConfig({
  testDir: 'e2e',
  // The tests share one seeded database, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-apis.mjs',
      url: `http://127.0.0.1:${MOCK_PORT}/health`,
      env: { MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      // Fresh database -> production build of the React app -> API server serving both.
      command: 'node e2e/prepare-db.mjs && npm run build -w apps/web && npm run start:e2e -w apps/api',
      url: `http://localhost:${APP_PORT}/api/health`,
      env: serverEnv,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
