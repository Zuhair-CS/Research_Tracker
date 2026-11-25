import { z } from 'zod';
import { normalizeDoi } from '../lib/identifiers.js';
import { Pagination, PublicationTypeSchema, optionalQuery } from './common.js';

const MAX_YEAR = new Date().getFullYear() + 1;

/**
 * SECURITY (stored XSS): the PDF link is shown as <a href="..."> in the UI.
 * A value like "javascript:alert(document.cookie)" would run code when
 * clicked, so only https:// links are accepted.
 */
const HttpsUrl = z.url({ protocol: /^https$/, message: 'Must be an https:// link' }).max(2048);

const DoiField = z
  .string()
  .trim()
  .max(250)
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const doi = normalizeDoi(value);
    if (!doi) {
      ctx.addIssue({ code: 'custom', message: 'Not a valid DOI (expected e.g. 10.1000/xyz123)' });
      return z.NEVER;
    }
    return doi;
  });

/**
 * Body for creating/updating a publication.
 *
 * SECURITY (mass assignment): z.strictObject rejects unknown fields. A
 * researcher cannot sneak in `ownerId` or `id` to take over someone else's
 * record - the owner is always set by the server from the session.
 */
export const PublicationInput = z.strictObject({
  title: z.string().trim().min(1).max(500),
  authors: z.array(z.string().trim().min(1).max(200)).min(1, 'At least one author is required').max(100),
  venue: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  year: z.int().min(1900).max(MAX_YEAR),
  doi: DoiField,
  type: PublicationTypeSchema,
  departmentId: z.uuid(),
  pdfUrl: z
    .union([HttpsUrl, z.literal(''), z.null()])
    .optional()
    .transform((v) => v || null),
  source: z.enum(['MANUAL', 'CROSSREF']).default('MANUAL'),
});
export type PublicationInput = z.infer<typeof PublicationInput>;

/** Search & filter parameters (used by the list page and the CSV export). */
export const PublicationQuery = z.strictObject({
  q: optionalQuery(z.string().trim().max(200)),
  author: optionalQuery(z.string().trim().max(200)),
  departmentId: optionalQuery(z.uuid()),
  type: optionalQuery(PublicationTypeSchema),
  year: optionalQuery(z.coerce.number().int().min(1900).max(3000)),
  yearFrom: optionalQuery(z.coerce.number().int().min(1900).max(3000)),
  yearTo: optionalQuery(z.coerce.number().int().min(1900).max(3000)),
  mine: optionalQuery(z.enum(['true', 'false'])).transform((v) => v === 'true'),
  sort: optionalQuery(z.enum(['year_desc', 'year_asc', 'title_asc', 'created_desc'])).transform(
    (v) => v ?? 'year_desc',
  ),
  ...Pagination,
});
export type PublicationQuery = z.infer<typeof PublicationQuery>;

export const DoiLookupQuery = z.strictObject({
  doi: z
    .string()
    .max(250)
    .transform((value, ctx) => {
      const doi = normalizeDoi(value);
      if (!doi) {
        ctx.addIssue({ code: 'custom', message: 'Not a valid DOI (expected e.g. 10.1000/xyz123)' });
        return z.NEVER;
      }
      return doi;
    }),
});
