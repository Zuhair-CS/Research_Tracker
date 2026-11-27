import { z } from 'zod';
import { config } from '../config/env.js';
import type { PublicationType } from '../generated/prisma/enums.js';
import { notFound } from '../lib/errors.js';
import { normalizeDoi } from '../lib/identifiers.js';
import { apiUrl, fetchJson, plainText } from './http-client.js';

/**
 * Client for the ORCID *public* API (read-only, no API key needed).
 * The ORCID iD passed in must already be validated by normalizeOrcid().
 */

export interface OrcidWork {
  putCode: string;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  doi: string | null;
  type: PublicationType;
}

const Value = z.object({ value: z.string().nullish() }).nullish();

const ExternalIds = z
  .object({
    'external-id': z
      .array(
        z.object({
          'external-id-type': z.string(),
          'external-id-value': z.string(),
          'external-id-relationship': z.string().nullish(),
        }),
      )
      .nullish(),
  })
  .nullish();

const WorkFields = {
  'put-code': z.union([z.number(), z.string()]),
  title: z.object({ title: Value }).nullish(),
  type: z.string().nullish(),
  'publication-date': z.object({ year: Value }).nullish(),
  'journal-title': Value,
  'external-ids': ExternalIds,
};

const WorksSummaryResponse = z.object({
  group: z.array(z.object({ 'work-summary': z.array(z.object(WorkFields)) })).default([]),
});

const BulkWorksResponse = z.object({
  bulk: z
    .array(
      z.object({
        work: z
          .object({
            ...WorkFields,
            contributors: z
              .object({ contributor: z.array(z.object({ 'credit-name': Value })).nullish() })
              .nullish(),
          })
          .nullish(),
      }),
    )
    .default([]),
});

export function mapOrcidType(type: string | null | undefined): PublicationType {
  switch (type) {
    case 'journal-article':
      return 'JOURNAL_ARTICLE';
    case 'conference-paper':
      return 'CONFERENCE_PAPER';
    case 'book':
    case 'edited-book':
      return 'BOOK';
    case 'book-chapter':
      return 'BOOK_CHAPTER';
    case 'dissertation':
    case 'dissertation-thesis':
      return 'THESIS';
    case 'preprint':
    case 'working-paper':
      return 'PREPRINT';
    default:
      return 'OTHER';
  }
}

type WorkInput = z.infer<z.ZodObject<typeof WorkFields>>;

function mapWork(w: WorkInput, authors: string[]): OrcidWork {
  const ids = w['external-ids']?.['external-id'] ?? [];
  const doiId =
    ids.find((id) => id['external-id-type'] === 'doi' && id['external-id-relationship'] === 'self') ??
    ids.find((id) => id['external-id-type'] === 'doi');
  const yearText = w['publication-date']?.year?.value;
  const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : null;
  const venue = w['journal-title']?.value;

  return {
    putCode: String(w['put-code']),
    title: plainText(w.title?.title?.value ?? ''),
    authors,
    venue: venue ? plainText(venue) : null,
    year,
    doi: doiId ? normalizeDoi(doiId['external-id-value']) : null,
    type: mapOrcidType(w.type),
  };
}

export function mapWorksSummary(raw: unknown): OrcidWork[] {
  const { group } = WorksSummaryResponse.parse(raw);
  // ORCID groups duplicates of the same work; the first summary is the preferred one.
  return group.flatMap((g) => (g['work-summary'][0] ? [mapWork(g['work-summary'][0], [])] : []));
}

export function mapBulkWorks(raw: unknown): OrcidWork[] {
  const { bulk } = BulkWorksResponse.parse(raw);
  return bulk.flatMap(({ work }) => {
    if (!work) return []; // ORCID returns an error entry for an unknown put-code
    const authors = (work.contributors?.contributor ?? [])
      .map((c) => plainText(c['credit-name']?.value ?? ''))
      .filter((name) => name.length > 0);
    return [mapWork(work, authors)];
  });
}

/** List the works on a public ORCID record (summaries only, without the author list). */
export async function fetchWorkSummaries(orcidId: string): Promise<OrcidWork[]> {
  const { status, body } = await fetchJson(apiUrl(config.ORCID_API_BASE, orcidId, 'works'), {});
  if (status === 404) throw notFound('ORCID record not found');
  return mapWorksSummary(body);
}

/** Fetch full details (including contributors) for up to 100 works in one call. */
export async function fetchWorkDetails(orcidId: string, putCodes: string[]): Promise<OrcidWork[]> {
  if (putCodes.length === 0) return [];
  // Put-codes are numbers; checking that keeps the comma-separated list safe to put in the URL as-is.
  if (putCodes.length > 100 || !putCodes.every((code) => /^\d{1,15}$/.test(code))) {
    throw new Error('Invalid ORCID put-codes');
  }
  const url = new URL(`${apiUrl(config.ORCID_API_BASE, orcidId, 'works').href}/${putCodes.join(',')}`);
  const { status, body } = await fetchJson(url, {});
  if (status === 404) throw notFound('ORCID record not found');
  return mapBulkWorks(body);
}

const PersonalDetails = z.object({
  name: z
    .object({
      'given-names': Value,
      'family-name': Value,
      'credit-name': Value,
    })
    .nullish(),
});

export interface OrcidRecord {
  orcidId: string;
  /** The published name; empty when the person keeps it private. */
  name: string;
  works: OrcidWork[];
}

/**
 * The public ORCID record: name and work list. Returns null when the iD has
 * no record. Used when OpenAlex has no profile linked to an ORCID iD (common
 * for researchers with few papers), so a search by iD still finds the person.
 */
export async function fetchOrcidRecord(orcidId: string): Promise<OrcidRecord | null> {
  const { status, body } = await fetchJson(apiUrl(config.ORCID_API_BASE, orcidId, 'personal-details'), {});
  if (status === 404) return null;
  const name = PersonalDetails.parse(body).name;
  const given = name?.['given-names']?.value ?? '';
  const family = name?.['family-name']?.value ?? '';
  const display = name?.['credit-name']?.value || [given, family].filter(Boolean).join(' ');
  return { orcidId, name: plainText(display), works: await fetchWorkSummaries(orcidId) };
}
