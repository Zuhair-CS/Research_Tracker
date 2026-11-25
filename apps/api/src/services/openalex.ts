import { z } from 'zod';
import { config } from '../config/env.js';
import type { PublicationType } from '../generated/prisma/enums.js';
import { notFound } from '../lib/errors.js';
import { normalizeDoi } from '../lib/identifiers.js';
import { nameParts, namesMatch } from '../lib/names.js';
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
export const INSTITUTION_ID = /^I\d{4,12}$/;
/** Most extra profiles that can be merged into one view. */
export const MAX_EXTRA_PROFILES = 10;

export interface OpenAlexAuthor {
  id: string;
  name: string;
  orcidId: string | null;
  worksCount: number;
  citedByCount: number;
  institutions: string[];
  /** OpenAlex ids of the institutions above (used to find the same person's other profiles). */
  institutionIds: string[];
}

/** "https://openalex.org/A5023888391" -> "A5023888391" */
const shortId = (url: string) => url.replace(/^https:\/\/openalex\.org\//, '');

const Author = z.object({
  id: z.string(),
  display_name: z.string().nullish(),
  orcid: z.string().nullish(),
  works_count: z.number().nullish(),
  cited_by_count: z.number().nullish(),
  last_known_institutions: z.array(z.object({ id: z.string().nullish(), display_name: z.string().nullish() })).nullish(),
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
  authorships: z
    .array(
      z.object({
        author: z.object({ id: z.string().nullish(), display_name: z.string().nullish() }),
        raw_author_name: z.string().nullish(),
        institutions: z.array(z.object({ id: z.string().nullish() })).nullish(),
      }),
    )
    .nullish(),
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
  const insts = (a.last_known_institutions ?? []).slice(0, 3);
  return {
    id: shortId(a.id),
    name: plainText(a.display_name ?? ''),
    orcidId: a.orcid ? a.orcid.replace(/^https:\/\/orcid\.org\//, '') : null,
    worksCount: a.works_count ?? 0,
    citedByCount: a.cited_by_count ?? 0,
    institutions: insts.map((i) => i.display_name ?? '').filter(Boolean),
    institutionIds: insts.map((i) => shortId(i.id ?? '')).filter((id) => INSTITUTION_ID.test(id)),
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

/** `author.id:A1|A2` - the ids are checked again here because they go into a filter string. */
function authorIdFilter(authorIds: string[]): string {
  if (authorIds.length === 0 || authorIds.length > MAX_EXTRA_PROFILES + 1 || !authorIds.every((id) => AUTHOR_ID.test(id))) {
    throw new Error('Invalid OpenAlex author ids');
  }
  return `author.id:${[...new Set(authorIds)].join('|')}`;
}

/**
 * One page of works from one or more author profiles (OpenAlex sometimes
 * splits one person into several profiles), newest first, with filters.
 */
export async function getAuthorWorks(authorIds: string[], f: WorkFilters, page: number, perPage = 50) {
  const filters = [authorIdFilter(authorIds), ...yearFilter(f.yearFrom, f.yearTo), ...typeFilter(f.type)];
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

/** Which of these DOIs are already on these OpenAlex profiles (used to de-duplicate extra matches). */
export async function authorHasDois(authorIds: string[], dois: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(dois)];
  for (let i = 0; i < unique.length; i += 50) {
    const { body } = await get(['works'], {
      filter: `${authorIdFilter(authorIds)},doi:${unique.slice(i, i + 50).map(filterText).join('|')}`,
      'per-page': '100',
      select: 'id,doi',
    });
    for (const r of ListResponse(z.object({ doi: z.string().nullish() })).parse(body).results) {
      const doi = r.doi ? normalizeDoi(r.doi) : null;
      if (doi) found.add(doi);
    }
  }
  return found;
}

export interface RelatedAuthor extends OpenAlexAuthor {
  /** Why we think it may be the same person. */
  reason: 'same-orcid' | 'same-name' | 'name-variant';
}

/**
 * Other OpenAlex profiles that may belong to the same person. OpenAlex creates
 * a new profile when a name is spelled differently ("S. Rastogi") or the
 * affiliation changes, so one faculty member's papers can be spread over
 * several profiles. Candidates are:
 *  - profiles with the same ORCID iD (certain);
 *  - profiles with a matching name ever affiliated with the same institution;
 *  - name spellings found on papers from that institution ("S. Rastogi").
 * They are only SUGGESTIONS: the user ticks the ones to include, and a
 * researcher still approves every paper before it is added to their account.
 */
export async function findRelatedAuthors(author: OpenAlexAuthor): Promise<RelatedAuthor[]> {
  const instIds = [...new Set([config.OPENALEX_INSTITUTION_ID, ...author.institutionIds])].filter(
    (id): id is string => Boolean(id && INSTITUTION_ID.test(id)),
  );
  const reasons = new Map<string, RelatedAuthor['reason']>();
  const found = new Map<string, OpenAlexAuthor>();
  const add = (a: OpenAlexAuthor, reason: RelatedAuthor['reason']) => {
    if (a.id === author.id || reasons.has(a.id)) return;
    reasons.set(a.id, reason);
    found.set(a.id, a);
  };

  const family = nameParts(author.name)?.family;
  const [byOrcid, byName, byPapers] = await Promise.allSettled([
    author.orcidId
      ? get(['authors'], { filter: `orcid:${author.orcidId}`, 'per-page': '10', select: AUTHOR_FIELDS })
      : Promise.resolve(null),
    instIds.length
      ? get(['authors'], {
          search: author.name,
          filter: `affiliations.institution.id:${instIds.join('|')}`,
          'per-page': '50',
          select: AUTHOR_FIELDS,
        })
      : Promise.resolve(null),
    instIds.length && family
      ? get(['works'], {
          filter: `raw_author_name.search:${filterText(family)},authorships.institutions.id:${instIds.join('|')}`,
          'per-page': '200',
          select: 'id,authorships',
        })
      : Promise.resolve(null),
  ]);

  if (byOrcid.status === 'fulfilled' && byOrcid.value) {
    for (const a of ListResponse(Author).parse(byOrcid.value.body).results) add(mapAuthor(a), 'same-orcid');
  }
  if (byName.status === 'fulfilled' && byName.value) {
    for (const a of ListResponse(Author).parse(byName.value.body).results.map(mapAuthor)) {
      if (namesMatch(a.name, author.name)) add(a, 'same-name');
    }
  }
  if (byPapers.status === 'fulfilled' && byPapers.value) {
    const variantIds = new Set<string>();
    const works = ListResponse(z.object({ authorships: Work.shape.authorships })).parse(byPapers.value.body).results;
    for (const w of works) {
      for (const a of w.authorships ?? []) {
        const id = shortId(a.author.id ?? '');
        const atInstitution = (a.institutions ?? []).some((i) => instIds.includes(shortId(i.id ?? '')));
        const name = a.raw_author_name ?? a.author.display_name ?? '';
        if (AUTHOR_ID.test(id) && id !== author.id && !reasons.has(id) && atInstitution && namesMatch(name, author.name)) {
          variantIds.add(id);
        }
      }
    }
    try {
      for (const a of await getAuthorsByIds([...variantIds].slice(0, 50))) add(a, 'name-variant');
    } catch {
      // Best effort: the other suggestions are still useful.
    }
  }

  const order = { 'same-orcid': 0, 'same-name': 1, 'name-variant': 2 } as const;
  return (
    [...found.values()]
      .map((a) => ({ ...a, reason: reasons.get(a.id) as RelatedAuthor['reason'] }))
      // Two different ORCID iDs = two different people.
      .filter((a) => !(author.orcidId && a.orcidId && a.orcidId !== author.orcidId))
      .sort((a, b) => order[a.reason] - order[b.reason] || b.worksCount - a.worksCount)
      .slice(0, MAX_EXTRA_PROFILES)
  );
}

async function getAuthorsByIds(ids: string[]): Promise<OpenAlexAuthor[]> {
  if (ids.length === 0) return [];
  if (ids.length > 50 || !ids.every((id) => AUTHOR_ID.test(id))) throw new Error('Invalid OpenAlex author ids');
  const { body } = await get(['authors'], { filter: `ids.openalex:${ids.join('|')}`, 'per-page': '50', select: AUTHOR_FIELDS });
  return ListResponse(Author).parse(body).results.map(mapAuthor);
}

export interface NamedWork {
  work: ScholarlyWork;
  /** The authorships on this paper whose printed name matches the person searched for. */
  matches: { authorId: string | null; institutionIds: string[] }[];
}

/**
 * Papers whose printed author list contains this name (any profile, any
 * institution). Used for "possible matches": the caller decides which are
 * plausible from the institutions on the matching authorship.
 */
export async function searchWorksByAuthorName(name: string, f: WorkFilters, perPage = 100): Promise<NamedWork[]> {
  const filters = [`raw_author_name.search:${filterText(name)}`, ...yearFilter(f.yearFrom, f.yearTo), ...typeFilter(f.type)];
  if (f.openAccessOnly) filters.push('open_access.is_oa:true');
  const { body } = await get(['works'], {
    filter: filters.join(','),
    sort: f.sort === 'citations' ? 'cited_by_count:desc' : 'publication_year:desc',
    'per-page': String(perPage),
    select: WORK_FIELDS,
  });
  return ListResponse(Work)
    .parse(body)
    .results.map((w) => ({
      work: mapWork(w),
      matches: (w.authorships ?? [])
        .filter((a) => namesMatch(a.raw_author_name ?? a.author.display_name ?? '', name))
        .map((a) => ({
          authorId: a.author.id ? shortId(a.author.id) : null,
          institutionIds: (a.institutions ?? []).map((i) => shortId(i.id ?? '')).filter((id) => INSTITUTION_ID.test(id)),
        })),
    }))
    .filter((w) => w.matches.length > 0);
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
