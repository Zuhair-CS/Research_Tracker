import { rateLimit } from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config/env.js';

/**
 * Rate limiting.
 *
 * SECURITY (brute force): without a limit an attacker can try thousands of
 * passwords per minute. After LOGIN_RATE_LIMIT failed attempts from one IP
 * address in 15 minutes, further login attempts get "429 Too Many Requests".
 * Successful logins do not count, so normal users are not affected.
 *
 * Note: the counters are kept in memory, which is fine for one app instance.
 * Several instances behind a load balancer would need a shared store (e.g. Redis).
 */
const message = { error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } };

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.LOGIN_RATE_LIMIT,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message,
});

/**
 * Sign-up: at most 5 new accounts per IP address per hour, so a script
 * cannot mass-create accounts (spam, filling the admins' approval queue).
 */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message,
});

/** A generous limit for the whole API, to slow down scraping and denial-of-service attempts. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message,
});

/**
 * File uploads (BibTeX import): parsing a large file costs CPU, so each user
 * may upload at most 30 files per 15 minutes (preview + import count separately).
 */
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? 'anonymous',
  message,
});

/**
 * DOI and ORCID look-ups make our server call external APIs. Limit them per
 * user so one account cannot use our server to flood Crossref or ORCID.
 */
export const externalLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? 'anonymous',
  message,
});
