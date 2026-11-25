import { execFileSync } from 'node:child_process';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Runs once before all tests: makes sure the test database exists and has
 * the latest schema (the same migrations as production).
 */
export default async function setup(project: TestProject): Promise<void> {
  const url = project.config.env.DATABASE_URL as string;
  const name = new URL(url).pathname.replace(/^\//, '');
  // Safety net: tests delete all data, so never run them against a real database.
  if (!/^[a-z0-9_]+_test$/i.test(name)) {
    throw new Error(`Refusing to run tests: database "${name}" must be named *_test`);
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    // The name was checked against a strict pattern above, so it is safe to quote here.
    if (!rowCount) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }

  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}
