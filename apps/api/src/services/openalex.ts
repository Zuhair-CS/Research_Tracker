import { z } from 'zod';
import { config } from '../config/env.js';
import type { PublicationType } from '../generated/prisma/enums.js';
import { notFound } from '../lib/errors.js';
import { normalizeDoi } from '../lib/identifiers.js';
import { USER_AGENT, apiUrl, fetchJson, plainText } from './http-client.js';
import type { ScholarlyWork, WorkFilters } from './scholarly-types.js';

/**
 * Client for OpenAlex (https://openalex.org), a free open catalogue of ~250M
 * scholarly works and ~90M researcher profiles. Unlike Crossref it knows
 * PEOPLE and their institutions, so it powers people search ("UPES faculty").
 *
 * SECURITY: author/work ids are validated against strict patterns before they
 * are put in a URL, free text only ever goes into URL-encoded query
 * parameters, and the optional API key is added here on the server only.
 */

export const AUTHOR_ID = /^A\d{4,12}$/;
export const WORK_ID = /^W\d{4,12}$/;

export interface OpenAlexAuthor {
  id: string;
  name: string;
  orcidId: string | null;
  worksCount: number;
  citedByCount: number;
  institutions: string[];
}

/** "https://openalex.org/A5023888391" -> "A5023888391" */
const shortId = (url: string) => url.replace(/^https:\/\/openalex\.org\//, '');

const Author = z.object({
  id: z.string(),
  display_name: z.string().nullish(),
  orcid: z.string().nullish(),
  works_count: z.number().nullish(),
  cited_by_count: z.number().nullish(),
  last_known_institutions: z.array(z.object({ display_name: z.string().nullish() })).nullish(),
});

const Source = z.object({ display_name: z.string().nullish(), type: z.string().nullish() }).nullish();

const Work = z.object({
  id: z.string(),
  doi: z.string().nullish(),
  title: z.string().nullish(),
  display_name: z.string().nullish(),
  publication_year: z.number().nullish(),
  type: z.string().nullish(),
  cited_by_count: z.number().nullish(),
  open_access: z.object({ is_oa: z.boolean().nullish() }).nullish(),
  primary_location: z.object({ source: Source }).nullish(),
  best_oa_location: z.object({ pdf_url: z.string().nullish() }).nullish(),
  authorships: z.array(z.object({ author: z.object({ display_name: z.string().nullish() }) })).nullish(),
});

const ListResponse = <T extends z.ZodType>(item: T) =>
  z.object({ meta: z.object({ count: z.number() }), results: z.array(item) });

const AUTHOR_FIELDS = 'id,display_name,orcid,works_count,cited_by_count,last_known_institutions';
const WORK_FIELDS =
  'id,doi,title,display_name,publication_year,type,cited_by_count,open_access,primary_location,best_oa_location,authorships';

export function mapOpenAlexType(type: string | null | undefined, sourceType: string | null | undefined): PublicationType {
  switch (type) {
    case 'article':
    case 'review':
    case 'letter':
    case 'editorial':
      // OpenAlex labels conference papers "article"; the venue type tells them apart.
      return sourceType === 'conference' ? 'CONFERENCE_PAPER' : 'JOURNAL_ARTICLE';
    case 'book':
      return 'BOOK';
    case 'book-chapter':
      return 'BOOK_CHAPTER';
    case 'dissertation':
      return 'THESIS';
    case 'preprint':
      return 'PREPRINT';
    default:
      return 'OTHER';
  }
}

/** Our publication type -> OpenAlex filter clauses. */
function typeFilter(type: PublicationType | undefined): string[] {
  switch (type) {
    case 'JOURNAL_ARTICLE':
      return ['type:article|review|letter|editorial', 'primary_location.source.type:!conference'];
    case 'CONFERENCE_PAPER':
      return ['type:article', 'primary_location.source.type:conference'];
    case 'BOOK':
      return ['type:book'];
    case 'BOOK_CHAPTER':
      return ['type:book-chapter'];
    case 'THESIS':
      return ['type:dissertation'];
    case 'PREPRINT':
      return ['type:preprint'];
    default:
      return [];
  }
}

function yearFilter(from?: number, to?: number): string[] {
  if (from && to) return [`publication_year:${from}-${to}`];
  if (from) return [`publication_year:>${from - 1}`];
  if (to) return [`publication_year:<${to + 1}`];
  return [];
}

export function mapAuthor(a: z.infer<typeof Author>): OpenAlexAuthor {
  return {
    id: shortId(a.id),
    name: plainText(a.display_name ?? ''),
    orcidId: a.orcid ? a.orcid.replace(/^https:\/\/orcid\.org\//, '') : null,
    worksCount: a.works_count ?? 0,
    citedByCount: a.cited_by_count ?? 0,
    institutions: (a.last_known_institutions ?? []).map((i) => i.display_name ?? '').filter(Boolean).slice(0, 3),
  };
}

export function mapWork(w: z.infer<typeof Work>): ScholarlyWork {
  const pdf = w.best_oa_location?.pdf_url;
  const venue = w.primary_location?.source?.display_name;
  return {
    openalexId: shortId(w.id),
    doi: w.doi ? normalizeDoi(w.doi) : null,
    title: plainText(w.title ?? w.display_name ?? ''),
    authors: (w.authorships ?? []).map((a) => plainText(a.author.display_name ?? '')).filter(Boolean),
    venue: venue ? plainText(venue) : null,
    year: w.publication_year ?? null,
    type: mapOpenAlexType(w.type, w.primary_location?.source?.type),
    // Only https PDF links are kept (same rule as manual entry).
    pdfUrl: pdf && pdf.startsWith('https://') ? pdf : null,
    citedByCount: w.cited_by_count ?? 0,
    openAccess: w.open_access?.is_oa ?? false,
    sources: ['openalex'],
  };
}

/** Call OpenAlex with query parameters, adding the contact e-mail and (optional) API key. */
async function get(path: string[], params: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const url = apiUrl(config.OPENALEX_API_BASE, ...path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (config.API_CONTACT_EMAIL) url.searchParams.set('mailto', config.API_CONTACT_EMAIL);
  if (config.OPENALEX_API_KEY) url.searchParams.set('api_key', config.OPENALEX_API_KEY);
  return fetchJson(url, { 'User-Agent': USER_AGENT });
}

/** Commas and pipes separate filters in OpenAlex, so they are removed from free text used inside a filter. */
const filterText = (text: string) => text.replace(/[,|:]/g, ' ').trim();

export interface AuthorSearch {
  q?: string;
  onlyOurInstitution: boolean;
  hasOrcid: boolean;
  sort: 'relevance' | 'works' | 'citations';
  page: number;
  perPage: number;
}

/**
 * Find researchers. With "only our institution" and an empty query this lists
 * everyone whose latest affiliation is our university (e.g. all UPES faculty).
 */
export async function searchAuthors(s: AuthorSearch): Promise<{ total: number; authors: OpenAlexAuthor[] }> {
  const filters: string[] = [];
  if (s.onlyOurInstitution && config.OPENALEX_INSTITUTION_ID) {
    filters.push(`last_known_institutions.id:${config.OPENALEX_INSTITUTION_ID}`);
  }
  if (s.hasOrcid) filters.push('has_orcid:true');

  const params: Record<string, string> = {
    'per-page': String(s.perPage),
    page: String(s.page),
    select: AUTHOR_FIELDS,
  };
  if (s.q) params.search = s.q;
  if (filters.length) params.filter = filters.join(',');
  if (s.sort === 'works' || (!s.q && s.sort === 'relevance')) params.sort = 'works_count:desc';
  if (s.sort === 'citations') params.sort = 'cited_by_count:desc';

  const { body } = await get(['authors'], params);
  const parsed = ListResponse(Author).parse(body);
  return { total: parsed.meta.count, authors: parsed.results.map(mapAuthor) };
}

export async function getAuthorByOrcid(orcidId: string): Promise<OpenAlexAuthor | null> {
  const { status, body } = await get(['authors', `orcid:${orcidId}`], { select: AUTHOR_FIELDS });
  return status === 404 ? null : mapAuthor(Author.parse(body));
}

export async function getAuthor(authorId: string): Promise<OpenAlexAuthor> {
  const { status, body } = await get(['authors', authorId], { select: AUTHOR_FIELDS });
  if (status === 404) throw notFound('Researcher not found in OpenAlex');
  return mapAuthor(Author.parse(body));
}

/** One page of an author's works, newest first, with optional year/type filters. */
export async function getAuthorWorks(authorId: string, f: WorkFilters, page: number, perPage = 50) {
  const filters = [`author.id:${authorId}`, ...yearFilter(f.yearFrom, f.yearTo), ...typeFilter(f.type)];
  if (f.openAccessOnly) filters.push('open_access.is_oa:true');
  const { body } = await get(['works'], {
    filter: filters.join(','),
    sort: f.sort === 'citations' ? 'cited_by_count:desc' : 'publication_year:desc',
    'per-page': String(perPage),
    page: String(page),
    select: WORK_FIELDS,
  });
  const parsed = ListResponse(Work).parse(body);
  return { total: parsed.meta.count, works: parsed.results.map(mapWork) };
}

/** Which of these DOIs are already on this author's OpenAlex profile (used to de-duplicate Crossref extras). */
export async function authorHasDois(authorId: string, dois: string[]): Promise<Set<string>> {
  if (dois.length === 0) return new Set();
  const { body } = await get(['works'], {
    filter: `author.id:${authorId},doi:${dois.map(filterText).join('|')}`,
    'per-page': '100',
    select: 'id,doi',
  });
  const parsed = ListResponse(z.object({ doi: z.string().nullish() })).parse(body);
  return new Set(parsed.results.map((r) => (r.doi ? normalizeDoi(r.doi) : null)).filter((d): d is string => Boolean(d)));
}

export interface WorkSearch extends WorkFilters {
  q?: string;
  author?: string;
  onlyOurInstitution: boolean;
  page: number;
  perPage: number;
}

/** Keyword / author-name search over all works, Google-Scholar style. */
export async function searchWorks(s: WorkSearch): Promise<{ total: number; works: ScholarlyWork[] }> {
  const filters = [...yearFilter(s.yearFrom, s.yearTo), ...typeFilter(s.type)];
  if (s.author) filters.push(`raw_author_name.search:${filterText(s.author)}`);
  if (s.onlyOurInstitution && config.OPENALEX_INSTITUTION_ID) {
    filters.push(`authorships.institutions.id:${config.OPENALEX_INSTITUTION_ID}`);
  }
  if (s.openAccessOnly) filters.push('open_access.is_oa:true');

  const params: Record<string, string> = { 'per-page': String(s.perPage), page: String(s.page), select: WORK_FIELDS };
  if (s.q) params.search = s.q;
  if (filters.length) params.filter = filters.join(',');
  if (s.sort === 'newest' || (!s.q && s.sort === 'relevance')) params.sort = 'publication_year:desc';
  if (s.sort === 'citations') params.sort = 'cited_by_count:desc';

  const { body } = await get(['works'], params);
  const parsed = ListResponse(Work).parse(body);
  return { total: parsed.meta.count, works: parsed.results.map(mapWork) };
}

/** Full details of specific works (max 50 per call, ids already validated against WORK_ID). */
export async function getWorksByIds(ids: string[]): Promise<ScholarlyWork[]> {
  if (ids.length === 0) return [];
  if (ids.length > 50 || !ids.every((id) => WORK_ID.test(id))) throw new Error('Invalid OpenAlex work ids');
  const { body } = await get(['works'], { filter: `ids.openalex:${ids.join('|')}`, 'per-page': '50', select: WORK_FIELDS });
  return ListResponse(Work).parse(body).results.map(mapWork);
}

let institutionName: Promise<string | null> | undefined;

/** Name of the configured university (looked up once and cached). */
export function getInstitutionName(): Promise<string | null> {
  const id = config.OPENALEX_INSTITUTION_ID;
  if (!id) return Promise.resolve(null);
  institutionName ??= get(['institutions', id], { select: 'display_name' })
    .then(({ body }) => z.object({ display_name: z.string() }).parse(body).display_name)
    .catch(() => {
      institutionName = undefined; // retry next time
      return null;
    });
  return institutionName;
}
