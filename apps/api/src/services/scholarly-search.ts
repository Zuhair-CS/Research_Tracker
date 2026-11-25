import { config } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { namesMatch, normalizeText, titleKey } from '../lib/names.js';
import { searchCrossref, type CrossrefHit } from './crossref.js';
import { authorHasDois, getAuthor, getAuthorWorks, getInstitutionName, searchWorks } from './openalex.js';
import type { ScholarlyWork, WorkFilters } from './scholarly-types.js';

/**
 * Combines OpenAlex and Crossref into one result list, the way Google Scholar
 * shows one entry per paper even when many sites have it.
 *
 * De-duplication: two records are the same paper when they share a DOI, or
 * (when one has no DOI) the same normalised title + year. The merged entry
 * keeps the OpenAlex data and fills gaps (PDF link, venue) from Crossref, and
 * lists both sources.
 */
export function mergeWorks(primary: ScholarlyWork[], extra: ScholarlyWork[] = []): ScholarlyWork[] {
  const out: ScholarlyWork[] = [];
  const byDoi = new Map<string, ScholarlyWork>();
  const byTitle = new Map<string, ScholarlyWork>();

  for (const incoming of [...primary, ...extra]) {
    const tKey = titleKey(incoming.title, incoming.year);
    const match = (incoming.doi && byDoi.get(incoming.doi)) || byTitle.get(tKey);
    if (match) {
      for (const s of incoming.sources) if (!match.sources.includes(s)) match.sources.push(s);
      match.doi ??= incoming.doi;
      match.openalexId ??= incoming.openalexId;
      match.pdfUrl ??= incoming.pdfUrl;
      match.venue ??= incoming.venue;
      match.citedByCount = Math.max(match.citedByCount, incoming.citedByCount);
      match.openAccess ||= incoming.openAccess;
      if (match.doi) byDoi.set(match.doi, match);
      continue;
    }
    // Copy only the public fields (drops Crossref's affiliation text).
    const w: ScholarlyWork = {
      openalexId: incoming.openalexId,
      doi: incoming.doi,
      title: incoming.title,
      authors: incoming.authors,
      venue: incoming.venue,
      year: incoming.year,
      type: incoming.type,
      pdfUrl: incoming.pdfUrl,
      citedByCount: incoming.citedByCount,
      openAccess: incoming.openAccess,
      sources: [...incoming.sources],
    };
    out.push(w);
    if (w.doi) byDoi.set(w.doi, w);
    if (w.title) byTitle.set(tKey, w);
  }
  return out;
}

/** True when any affiliation text names one of the institutions (whole-word match, case/accents ignored). */
export function affiliationMatches(affiliations: string[], institutions: string[]): boolean {
  const names = institutions.map(normalizeText).filter((n) => n.length >= 3);
  return affiliations.some((aff) => {
    const text = ` ${normalizeText(aff)} `;
    return names.some((n) => text.includes(` ${n} `));
  });
}

async function ourInstitutionNames(): Promise<string[]> {
  const name = await getInstitutionName();
  return [...(name ? [name] : []), ...config.INSTITUTION_ALIASES];
}

export interface PublicationSearch extends WorkFilters {
  q?: string;
  author?: string;
  onlyOurInstitution: boolean;
  useOpenAlex: boolean;
  useCrossref: boolean;
  page: number;
}

const PER_PAGE = 20;

export async function searchPublications(s: PublicationSearch) {
  const ourNames = s.onlyOurInstitution ? await ourInstitutionNames() : [];
  // Crossref has no open-access flag, so it is skipped for "open access only".
  const useCrossref = s.useCrossref && !s.openAccessOnly;

  const [oa, cr] = await Promise.allSettled([
    s.useOpenAlex ? searchWorks({ ...s, perPage: PER_PAGE }) : Promise.resolve(null),
    useCrossref
      ? searchCrossref({
          ...s,
          affiliation: s.onlyOurInstitution ? ourNames[0] : undefined,
          offset: (s.page - 1) * PER_PAGE,
          rows: PER_PAGE * 2, // over-fetch: some hits are removed by the filters below
        })
      : Promise.resolve(null),
  ]);

  const warnings: string[] = [];
  if (oa.status === 'rejected') {
    logger.warn({ error: String(oa.reason) }, 'OpenAlex search failed');
    warnings.push(
      oa.reason instanceof HttpError && oa.reason.code === 'UPSTREAM_RATE_LIMITED'
        ? `${oa.reason.message} Showing Crossref results only.`
        : 'OpenAlex is not responding right now; showing Crossref results only.',
    );
  }
  if (cr.status === 'rejected') {
    logger.warn({ error: String(cr.reason) }, 'Crossref search failed');
    warnings.push('Crossref is not responding right now; showing OpenAlex results only.');
  }
  if (s.useCrossref && s.openAccessOnly) warnings.push('Crossref has no open-access flag, so only OpenAlex was searched.');

  const oaResult = oa.status === 'fulfilled' ? oa.value : null;
  let crossrefHits: CrossrefHit[] = cr.status === 'fulfilled' && cr.value ? cr.value.works : [];
  // Crossref ranks fuzzy matches; keep only hits that really match the filters.
  if (s.author) crossrefHits = crossrefHits.filter((w) => w.authors.some((a) => namesMatch(a, s.author as string)));
  if (s.onlyOurInstitution) crossrefHits = crossrefHits.filter((w) => affiliationMatches(w.affiliations, ourNames));

  let works = mergeWorks(oaResult?.works ?? [], crossrefHits);
  if (s.sort === 'newest') works = works.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  if (s.sort === 'citations') works = works.sort((a, b) => b.citedByCount - a.citedByCount);

  return {
    works,
    page: s.page,
    perPage: PER_PAGE,
    totals: {
      openalex: oaResult?.total ?? 0,
      crossref: cr.status === 'fulfilled' && cr.value ? cr.value.total : 0,
    },
    warnings,
  };
}

/**
 * A researcher's papers: their OpenAlex profile, plus (on page 1) papers that
 * Crossref attributes to the same name AND institution but OpenAlex missed.
 */
export async function getResearcherWorks(authorId: string, filters: WorkFilters, page: number) {
  const [author, oa] = await Promise.all([getAuthor(authorId), getAuthorWorks(authorId, filters, page)]);
  const works = mergeWorks(oa.works);
  let crossrefExtras: ScholarlyWork[] = [];
  const warnings: string[] = [];

  if (page === 1 && !filters.openAccessOnly && author.name) {
    try {
      const ourNames = await ourInstitutionNames();
      const institutions = [...author.institutions, ...(affiliationMatches(author.institutions, ourNames) ? ourNames : [])];
      const cr = await searchCrossref({
        ...filters,
        sort: filters.sort === 'citations' ? 'citations' : undefined,
        author: author.name,
        affiliation: author.institutions[0],
        offset: 0,
        rows: 60,
      });
      // Strict on purpose: same name AND one of the person's institutions, so
      // papers by other people with a similar name are not offered.
      const candidates = cr.works.filter(
        (w) => w.doi && w.authors.some((a) => namesMatch(a, author.name)) && affiliationMatches(w.affiliations, institutions),
      );
      const onProfile = await authorHasDois(authorId, candidates.map((c) => c.doi as string));
      const seen = new Set(works.map((w) => titleKey(w.title, w.year)));
      crossrefExtras = mergeWorks(candidates.filter((c) => !onProfile.has(c.doi as string) && !seen.has(titleKey(c.title, c.year))));
    } catch (err) {
      logger.warn({ error: String(err) }, 'Crossref supplement failed');
      warnings.push('Could not check Crossref for extra papers right now.');
    }
  }

  return { author, total: oa.total, page, works, crossrefExtras, warnings };
}
