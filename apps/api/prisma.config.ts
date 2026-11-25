import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Load the repository-level .env for local development (Node's built-in
// loader, so no extra dependency). In Docker/CI the variables are injected
// by the environment instead and there is no .env file.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
