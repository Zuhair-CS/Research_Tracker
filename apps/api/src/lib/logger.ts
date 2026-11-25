import { pino } from 'pino';
import { config } from '../config/env.js';

/**
 * Structured JSON logger.
 *
 * SECURITY: "redact" removes sensitive values before a log line is written,
 * so session cookies, CSRF tokens and passwords never end up in log files
 * (logs are often shipped to other systems and read by more people).
 */
export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.currentPassword',
      '*.newPassword',
    ],
    censor: '[REDACTED]',
  },
});
