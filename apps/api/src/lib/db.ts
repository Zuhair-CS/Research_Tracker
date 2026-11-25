import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { config } from '../config/env.js';

// One connection pool shared by Prisma and the session store.
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export type Db = typeof prisma;
