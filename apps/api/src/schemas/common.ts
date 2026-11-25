import { z } from 'zod';

/**
 * SECURITY (input validation): every value that comes from the client - body,
 * URL parameters and query string - is checked against a zod schema before
 * use. Anything unexpected (wrong type, too long, unknown field) is rejected
 * with 400, so the rest of the code only ever sees well-formed data.
 */

/** Treat `?type=` (empty) the same as a missing parameter. */
export const optionalQuery = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const IdParam = z.strictObject({ id: z.uuid() });

export const Pagination = {
  page: optionalQuery(z.coerce.number().int().min(1).max(10_000)).transform((v) => v ?? 1),
  pageSize: optionalQuery(z.coerce.number().int().min(1).max(100)).transform((v) => v ?? 20),
};

export const RoleSchema = z.enum(['ADMIN', 'RESEARCHER', 'VIEWER']);
export const ResearcherTypeSchema = z.enum(['FACULTY', 'STUDENT']);
export const PublicationTypeSchema = z.enum([
  'JOURNAL_ARTICLE',
  'CONFERENCE_PAPER',
  'BOOK',
  'BOOK_CHAPTER',
  'THESIS',
  'PREPRINT',
  'OTHER',
]);

export const EmailSchema = z.email().max(254).transform((e) => e.toLowerCase());

/**
 * Password rules follow NIST SP 800-63B: length matters most, so we require
 * 12+ characters and no forced symbol rules. The 128 limit stops someone
 * sending a 10 MB "password" to make hashing slow.
 */
export const NewPasswordSchema = z.string().min(12, 'Password must be at least 12 characters').max(128);
