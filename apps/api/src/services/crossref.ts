import { z } from 'zod';
import { config } from '../config/env.js';
import type { PublicationType } from '../generated/prisma/enums.js';
import { notFound } from '../lib/errors.js';
import { USER_AGENT, apiUrl, fetchJson, plainText } from './http-client.js';
import type { ScholarlyWork, WorkFilters } from './scholarly-types.js';

/** Publication details suggested to the user; they review them before saving. */
export interface PublicationDraft {
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  doi: string;
  type: PublicationType;
  pdfUrl: string | null;
}

/** A Crossref search hit, plus the affiliation text used to check "is this from our university?". */
export interface CrossrefHit extends ScholarlyWork {
  affiliations: string[];
}

// Only the fields we use; everything else in the Crossref response is ignored.
const DateParts = z.object({ 'date-parts': z.array(z.array(z.number().nullable())).nullish() }).nullish();
const CrossrefItem = z.object({
  DOI: z.string(),
  title: z.array(z.string()).nullish(),
  author: z
    .array(
      z.object({
        given: z.string().nullish(),
        family: z.string().nullish(),
        name: z.string().nullish(),
        affiliation: z.array(z.object({ name: z.string().nullish() })).nullish(),
      }),
    )
    .nullish(),
  'container-title': z.array(z.string()).nullish(),
  type: z.string().nullish(),
  issued: DateParts,
  published: DateParts,
  link: z.array(z.object({ URL: z.string(), 'content-type': z.string().nullish() })).nullish(),
  'is-referenced-by-count': z.number().nullish(),
});
type CrossrefItem = z.infer<typeof CrossrefItem>;

const SEARCH_FIELDS = 'DOI,title,author,container-title,type,issued,published,link,is-referenced-by-count';

export function mapCrossrefType(type: string | null | undefined): PublicationType {
  switch (type) {
    case 'journal-article':
      return 'JOURNAL_ARTICLE';
    case 'proceedings-article':
      return 'CONFERENCE_PAPER';
    case 'book':
    case 'monograph':
    case 'edited-book':
      return 'BOOK';
    case 'book-chapter':
    case 'book-section':
      return 'BOOK_CHAPTER';
    case 'dissertation':
      return 'THESIS';
    case 'posted-content':
      return 'PREPRINT';
    default:
      return 'OTHER';
  }
}

/** Our publication type -> Crossref filter clauses (several type: clauses mean OR). */
const CROSSREF_TYPES: Record<PublicationType, string[]> = {
  JOURNAL_ARTICLE: ['journal-article'],
  CONFERENCE_PAPER: ['proceedings-article'],
  BOOK: ['book', 'monograph', 'edited-book'],
  BOOK_CHAPTER: ['book-chapter'],
  THESIS: ['dissertation'],
  PREPRINT: ['posted-content'],
  OTHER: [],
};

function mapItem(m: CrossrefItem): CrossrefHit {
  const year = m.issued?.['date-parts']?.[0]?.[0] ?? m.published?.['date-parts']?.[0]?.[0] ?? null;
  const authors = (m.author ?? [])
    .map((a) => plainText(a.name ?? [a.given, a.family].filter(Boolean).join(' ')))
    .filter((name) => name.length > 0);
  // Only accept an https:// PDF link, never javascript: or http: URLs.
  const pdf = (m.link ?? []).find((l) => l['content-type'] === 'application/pdf' && l.URL.startsWith('https://'));
  return {
    openalexId: null,
    doi: m.DOI.toLowerCase(),
    title: plainText(m.title?.[0] ?? ''),
    authors,
    venue: m['container-title']?.[0] ? plainText(m['container-title'][0]) : null,
    year,
    type: mapCrossrefType(m.type),
    pdfUrl: pdf?.URL ?? null,
    citedByCount: m['is-referenced-by-count'] ?? 0,
    openAccess: false,
    sources: ['crossref'],
    affiliations: (m.author ?? []).flatMap((a) => (a.affiliation ?? []).map((af) => af.name ?? '')).filter(Boolean),
  };
}

export function mapCrossrefWork(raw: unknown): PublicationDraft {
  const { message } = z.object({ message: CrossrefItem }).parse(raw);
  const { title, authors, venue, year, doi, type, pdfUrl } = mapItem(message);
  return { title, authors, venue, year, doi: doi as string, type, pdfUrl };
}

/** Look up a DOI in Crossref. The DOI must already be validated by normalizeDoi(). */
export async function lookupDoi(doi: string): Promise<PublicationDraft> {
  // apiUrl() encodes the DOI so it stays inside one path segment of the fixed Crossref URL.
  const url = apiUrl(config.CROSSREF_API_BASE, 'works', doi);
  const { status, body } = await fetchJson(url, { 'User-Agent': USER_AGENT });
  if (status === 404) throw notFound('DOI not found in Crossref');
  return mapCrossrefWork(body);
}

export interface CrossrefSearch extends WorkFilters {
  q?: string;
  author?: string;
  affiliation?: string;
  offset: number;
  rows: number;
}

/**
 * Search Crossref's ~170M records. Crossref matching is fuzzy ("best match
 * first"), so callers post-filter the hits by author name / affiliation.
 * All free text goes into URL-encoded query parameters.
 */
export async function searchCrossref(s: CrossrefSearch): Promise<{ total: number; works: CrossrefHit[] }> {
  const url = apiUrl(config.CROSSREF_API_BASE, 'works');
  const p = url.searchParams;
  if (s.q) p.set('query.bibliographic', s.q);
  if (s.author) p.set('query.author', s.author);
  if (s.affiliation) p.set('query.affiliation', s.affiliation);

  const filters: string[] = [];
  if (s.yearFrom) filters.push(`from-pub-date:${s.yearFrom}`);
  if (s.yearTo) filters.push(`until-pub-date:${s.yearTo}`);
  if (s.type) filters.push(...CROSSREF_TYPES[s.type].map((t) => `type:${t}`));
  if (filters.length) p.set('filter', filters.join(','));
  if (s.sort === 'newest') {
    p.set('sort', 'published');
    p.set('order', 'desc');
  } else if (s.sort === 'citations') {
    p.set('sort', 'is-referenced-by-count');
    p.set('order', 'desc');
  }
  p.set('rows', String(s.rows));
  p.set('offset', String(Math.min(s.offset, 9_000))); // Crossref caps offset paging at 10,000
  p.set('select', SEARCH_FIELDS);
  if (config.API_CONTACT_EMAIL) p.set('mailto', config.API_CONTACT_EMAIL);

  const { body } = await fetchJson(url, { 'User-Agent': USER_AGENT });
  const parsed = z
    .object({ message: z.object({ 'total-results': z.number(), items: z.array(CrossrefItem) }) })
    .parse(body);
  return { total: parsed.message['total-results'], works: parsed.message.items.map(mapItem) };
}
