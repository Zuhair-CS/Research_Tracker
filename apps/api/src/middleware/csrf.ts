import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';

/**
 * CSRF protection (synchronizer token pattern, OWASP recommended).
 *
 * The problem: browsers attach our session cookie to ANY request sent to our
 * site - including one triggered by a hidden form on an attacker's web page.
 * Without protection, that page could delete a publication in the victim's name.
 *
 * The fix: each session gets a random secret token. The React app reads it
 * from GET /api/auth/csrf and sends it back in the "X-CSRF-Token" header on
 * every change (POST/PUT/PATCH/DELETE). An attacker's page cannot read the
 * token (the browser's same-origin policy blocks it), so its forged requests
 * are rejected. The SameSite=Strict cookie is a second, independent layer.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-csrf-token';

export function issueCsrfToken(req: Request): string {
  req.session.csrfToken ??= randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session?.csrfToken;
  const received = req.get(CSRF_HEADER);
  if (!expected || !received || !safeEqual(expected, received)) {
    return next(new HttpError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'));
  }
  next();
}

/** Constant-time comparison, so the token cannot be guessed byte-by-byte from response timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
