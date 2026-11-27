import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { config } from './config/env.js';
import { prisma } from './lib/db.js';
import { logger } from './lib/logger.js';
import { loadUser, requireAuth } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { apiNotFound, errorHandler } from './middleware/error-handler.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { corsAllowList, permissionsPolicy, securityHeaders } from './middleware/security.js';
import { sessionMiddleware } from './middleware/session.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { bibtexRouter } from './routes/bibtex.js';
import { healthRouter } from './routes/health.js';
import { claimsRouter } from './routes/claims.js';
import { discoverRouter } from './routes/discover.js';
import { notificationsRouter } from './routes/notifications.js';
import { orcidRouter } from './routes/orcid.js';
import { publicationsRouter } from './routes/publications.js';
import { reportsRouter } from './routes/reports.js';

/**
 * Builds the Express application. The ORDER of the middleware matters:
 *
 *   security headers -> CORS -> rate limit -> body parser (size-limited)
 *   -> session -> CSRF check -> load user -> PUBLIC routes
 *   -> requireAuth (deny by default) -> PROTECTED routes -> error handler
 */
export function createApp(): Express {
  const app = express();

  // Do not advertise "X-Powered-By: Express" (helps attackers pick exploits).
  app.disable('x-powered-by');
  // Behind a reverse proxy, trust exactly TRUST_PROXY hops for the client IP.
  // (Trusting every proxy would let a client fake its IP and dodge rate limits.)
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false } }));
  app.use(securityHeaders, permissionsPolicy);

  // ------------------------------------------------------------------ API
  const api = express.Router();
  api.use(corsAllowList, apiLimiter);
  // Small body limit: no legitimate request is bigger, and huge bodies are a DoS vector.
  api.use(express.json({ limit: '100kb' }));
  // API responses contain user data; tell browsers and proxies not to cache them.
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.use('/health', healthRouter); // no session needed

  api.use(sessionMiddleware, csrfProtection, loadUser);
  api.use('/auth', authRouter); // csrf + login are public; /me and /password check auth themselves

  // SECURITY: everything below this line requires a logged-in user.
  api.use(requireAuth);
  api.get('/departments', async (_req, res) => {
    res.json({
      items: await prisma.department.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
    });
  });
  api.use('/publications', publicationsRouter);
  api.use('/orcid', orcidRouter);
  api.use('/discover', discoverRouter);
  api.use('/import/bibtex', bibtexRouter);
  api.use('/claims', claimsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/reports', reportsRouter);
  api.use('/admin', adminRouter);
  api.use(apiNotFound);

  app.use('/api', api);

  // ---------------------------------------------- React app (production)
  const webDir = config.WEB_DIST_DIR ? path.resolve(config.WEB_DIST_DIR) : undefined;
  if (webDir && existsSync(path.join(webDir, 'index.html'))) {
    // Built files have a content hash in their names, so they can be cached for a long time.
    app.use('/assets', express.static(path.join(webDir, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(webDir, { index: false, dotfiles: 'ignore' }));
    // Single-page app: unknown paths return index.html and React Router shows the page.
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile('index.html', { root: webDir });
    });
  }

  app.use(errorHandler);
  return app;
}
