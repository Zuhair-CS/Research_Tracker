import { z } from 'zod';

/**
 * All configuration comes from environment variables, checked once at startup.
 *
 * SECURITY: secrets (DB password, session secret) are never written in the
 * code. If a required variable is missing or too weak, the app refuses to
 * start instead of running with an insecure default ("fail closed").
 */

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

/** A blank optional variable (e.g. `OPENALEX_API_KEY=`) counts as not set. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().startsWith('postgresql://'),

    // A short secret can be guessed by brute force, so we require 32+ characters.
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    COOKIE_SECURE: bool.default(true),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    // How long a logged-in session stays valid without activity.
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(120),

    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url())),

    CROSSREF_API_BASE: z.url().default('https://api.crossref.org'),
    ORCID_API_BASE: z.url().default('https://pub.orcid.org/v3.0'),
    OPENALEX_API_BASE: z.url().default('https://api.openalex.org'),
    // Optional free OpenAlex key (https://openalex.org/settings/api). It is a SECRET:
    // it only ever comes from the environment and is never logged or sent to the browser.
    OPENALEX_API_KEY: optional(z.string().min(8).max(200)),
    // Optional OpenAlex id of our university (e.g. I27837315), used for "only our researchers" searches.
    OPENALEX_INSTITUTION_ID: optional(z.string().regex(/^I\d{3,12}$/, 'must look like I27837315')),
    // Other names the university appears under in publisher affiliation text (Crossref), comma separated.
    INSTITUTION_ALIASES: z
      .string()
      .default('')
      .transform((s) => s.split(',').map((a) => a.trim()).filter(Boolean)),
    // Contact e-mail sent to Crossref and OpenAlex, as both APIs request ("polite pool").
    API_CONTACT_EMAIL: optional(z.email()),
    EXTERNAL_API_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(8000),

    // Folder with the built React app. When set, Express serves it (production image).
    WEB_DIST_DIR: optional(z.string()),

    // Self-service sign-up. New accounts start as read-only Viewers; an admin
    // must approve Faculty/Student (researcher) access.
    SIGNUP_ENABLED: bool.default(true),
    // Only e-mail addresses at these domains may sign up (comma separated, e.g.
    // "upes.ac.in,stu.upes.ac.in"). Empty = any domain (fine for local development only).
    SIGNUP_ALLOWED_DOMAINS: z
      .string()
      .default('')
      .transform((s) => s.split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)),

    // Login rate limit: attempts allowed per IP address in each 15-minute window.
    LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.COOKIE_SECURE, {
    // In production the session cookie must never travel over plain HTTP.
    message: 'COOKIE_SECURE must be true in production',
    path: ['COOKIE_SECURE'],
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    // Print only the variable names and problems, never the values (they may be secrets).
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export const config = loadConfig();
