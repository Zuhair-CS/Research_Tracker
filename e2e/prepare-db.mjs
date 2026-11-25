// Recreate the end-to-end database from scratch: drop, create, migrate, seed.
// Runs before the app server starts (see playwright.config.ts).
import { execSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const name = url ? new URL(url).pathname.replace(/^\//, '') : '';
// Safety net: this script deletes the whole database, so it only accepts *_e2e names.
if (!/^[a-z0-9_]+_e2e$/i.test(name)) {
  console.error(`Refusing to reset database "${name}": its name must end in _e2e`);
  process.exit(1);
}

const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
// The name was checked against a strict pattern above, so quoting it here is safe.
await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
await client.query(`CREATE DATABASE "${name}"`);
await client.end();

const api = path.resolve(import.meta.dirname, '..', 'apps', 'api');
execSync('npx prisma migrate deploy', { cwd: api, stdio: 'inherit', env: process.env });
execSync('npx prisma db seed', { cwd: api, stdio: 'inherit', env: process.env });
