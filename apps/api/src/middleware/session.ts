import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { config } from '../config/env.js';
import { pool } from '../lib/db.js';

const PgStore = connectPgSimple(session);

/**
 * The "__Host-" prefix is a browser-enforced rule: the cookie is only
 * accepted if it is Secure, has Path=/ and no Domain. That stops a
 * sub-domain (e.g. a hacked blog.university.edu) from overwriting it.
 * Browsers only allow the prefix on Secure cookies.
 */
export const SESSION_COOKIE_NAME = config.COOKIE_SECURE ? '__Host-pubtrack.sid' : 'pubtrack.sid';

/**
 * Server-side sessions.
 *
 * SECURITY: the browser only holds a random session ID in a cookie; the
 * session data itself stays in PostgreSQL. The cookie is:
 *  - httpOnly  -> JavaScript cannot read it, so an XSS bug cannot steal it
 *  - secure    -> only sent over HTTPS, so it cannot be sniffed on Wi-Fi
 *  - sameSite=strict -> not sent on requests that come from other websites (CSRF defence)
 *  - signed with SESSION_SECRET -> it cannot be forged or tampered with
 * Sessions expire after SESSION_IDLE_MINUTES without activity ("rolling").
 */
export const sessionMiddleware = session({
  name: SESSION_COOKIE_NAME,
  secret: config.SESSION_SECRET,
  store: new PgStore({
    pool,
    tableName: 'session',
    createTableIfMissing: false, // the table is created by our Prisma migration
    pruneSessionInterval: config.NODE_ENV === 'test' ? false : 15 * 60,
  }),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: config.TRUST_PROXY > 0,
  cookie: {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    maxAge: config.SESSION_IDLE_MINUTES * 60 * 1000,
  },
});
