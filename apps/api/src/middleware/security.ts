import type { RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from '../config/env.js';
import { CSRF_HEADER } from './csrf.js';

/**
 * HTTP security headers (helmet). Each header tells the browser to switch on
 * a protection:
 *  - Content-Security-Policy: only run scripts/styles loaded from our own
 *    site. Even if an attacker manages to inject <script> into a page (XSS),
 *    the browser refuses to execute it.
 *  - frame-ancestors 'none' / X-Frame-Options: our pages cannot be embedded
 *    in another site's invisible iframe (clickjacking).
 *  - Strict-Transport-Security: the browser always uses HTTPS for our site.
 *  - X-Content-Type-Options: nosniff: files are not "guessed" into scripts.
 *  - Referrer-Policy: do not leak our URLs to other sites.
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(config.COOKIE_SECURE ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
});

/** Turn off powerful browser features the app never uses. */
export const permissionsPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
};

/**
 * CORS allow-list.
 *
 * SECURITY: by default a browser blocks a web page on another site from
 * reading our API responses. CORS can relax that rule; we relax it ONLY for
 * the origins listed in CORS_ORIGINS (e.g. the Vite dev server). Any other
 * origin gets no CORS headers, so the browser keeps blocking it.
 * In production the React app is served by this same server (same origin),
 * so CORS_ORIGINS can stay empty.
 */
export const corsAllowList: RequestHandler = cors({
  origin: (origin, callback) => {
    if (!origin || config.CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', CSRF_HEADER],
  maxAge: 600,
});
