import { Router } from 'express';
import { prisma } from '../lib/db.js';

/**
 * Public health checks for Docker / the deployment pipeline.
 * SECURITY: they reveal nothing about versions or configuration.
 */
export const healthRouter = Router();

// "Is the process alive?"
healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

// "Can it serve traffic?" (database reachable)
healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`; // tagged template = parameterised, not string concatenation
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
