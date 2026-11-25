import { config } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { namesMatch, normalizeText, titleKey } from '../lib/names.js';
import { searchCrossref, type CrossrefHit } from './crossref.js';
import { authorHasDois, getAuthor, getAuthorWorks, getInstitutionName, searchWorks, searchWorksByAuthorName } from './openalex.js';
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
      match.matchNote ??= incoming.matchNote;
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
      ...(incoming.matchNote ? { matchNote: incoming.matchNote } : {}),
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

/** Most "possible matches" shown at once (they all need a human check). */
const MAX_POSSIBLE = 60;

/**
 * A researcher's papers, from one or more OpenAlex profiles (the first id is
 * the main profile, the rest are profiles the user chose to merge in).
 *
 * On page 1 two more lists are added:
 *  - crossrefExtras ("confirmed"): Crossref papers with the same name AND the
 *    person's institution in the affiliation text, missing from the profiles.
 *  - possibleMatches ("unconfirmed"): papers with the same name where the
 *    institution cannot be checked (no affiliation recorded), or that sit on a
 *    different OpenAlex profile at the same institution. These are never
 *    pre-selected: a person must look at each one, and the researcher still
 *    approves anything an admin sends them.
 * Papers listing the name at a DIFFERENT institution are dropped: they are
 * most likely someone else with the same name.
 */
export async function getResearcherWorks(authorIds: string[], filters: WorkFilters, page: number) {
  const mainId = authorIds[0] as string;
  const [author, oa] = await Promise.all([getAuthor(mainId), getAuthorWorks(authorIds, filters, page)]);
  const works = mergeWorks(oa.works);
  let crossrefExtras: ScholarlyWork[] = [];
  let possibleMatches: ScholarlyWork[] = [];
  const warnings: string[] = [];

  if (page === 1 && author.name) {
    const ourNames = await ourInstitutionNames();
    const institutions = [...author.institutions, ...(affiliationMatches(author.institutions, ourNames) ? ourNames : [])];
    const instIds = new Set([config.OPENALEX_INSTITUTION_ID, ...author.institutionIds].filter(Boolean));
    const profileIds = new Set(authorIds);

    const [cr, byName] = await Promise.allSettled([
      // Crossref has no open-access flag, so it is skipped for "open access only".
      filters.openAccessOnly
        ? Promise.resolve(null)
        : searchCrossref({
            ...filters,
            sort: filters.sort === 'citations' ? 'citations' : undefined,
            author: author.name,
            affiliation: author.institutions[0],
            offset: 0,
            rows: 100,
          }),
      searchWorksByAuthorName(author.name, filters),
    ]);

    const confirmed: ScholarlyWork[] = [];
    const possible: ScholarlyWork[] = [];

    if (byName.status === 'fulfilled') {
      for (const { work, matches } of byName.value) {
        // Already on one of the profiles being shown.
        if (matches.some((m) => m.authorId && profileIds.has(m.authorId))) continue;
        const insts = matches.flatMap((m) => m.institutionIds);
        if (insts.length === 0) {
          possible.push({ ...work, matchNote: 'Same name on OpenAlex, but no affiliation is recorded' });
        } else if (insts.some((i) => instIds.has(i))) {
          possible.push({ ...work, matchNote: 'Same name and institution, but on another OpenAlex profile' });
        }
      }
    } else {
      logger.warn({ error: String(byName.reason) }, 'OpenAlex name search failed');
      warnings.push('Could not search OpenAlex for other papers under this name right now.');
    }

    if (cr.status === 'fulfilled' && cr.value) {
      for (const w of cr.value.works) {
        const me = w.authorList.filter((a) => namesMatch(a.name, author.name));
        if (!w.doi || me.length === 0) continue;
        const own = me.flatMap((a) => a.affiliations);
        if (own.length > 0) {
          // The person's own affiliation is printed: keep only if it is their institution.
          if (affiliationMatches(own, institutions)) confirmed.push(w);
        } else if (affiliationMatches(w.affiliations, institutions)) {
          // No affiliation for them, but a co-author is from the same institution: strong hint.
          confirmed.push(w);
        } else {
          possible.push({ ...w, matchNote: 'Same name on Crossref, but no affiliation is recorded' });
        }
      }
    } else if (cr.status === 'rejected') {
      logger.warn({ error: String(cr.reason) }, 'Crossref supplement failed');
      warnings.push('Could not check Crossref for extra papers right now.');
    }

    // Drop anything already on the profiles (by DOI, OpenAlex id or title + year).
    try {
      const dois = [...confirmed, ...possible].map((w) => w.doi).filter((d): d is string => Boolean(d));
      const onProfile = await authorHasDois(authorIds, dois);
      const seenTitles = new Set(works.map((w) => titleKey(w.title, w.year)));
      const seenIds = new Set(works.map((w) => w.openalexId).filter(Boolean));
      const isNew = (w: ScholarlyWork) =>
        !(w.doi && onProfile.has(w.doi)) && !(w.openalexId && seenIds.has(w.openalexId)) && !seenTitles.has(titleKey(w.title, w.year));

      crossrefExtras = mergeWorks(confirmed.filter(isNew));
      const confirmedDois = new Set(crossrefExtras.map((w) => w.doi));
      const confirmedTitles = new Set(crossrefExtras.map((w) => titleKey(w.title, w.year)));
      // Strongest hints first: same institution on another profile, then the rest.
      const rank = (w: ScholarlyWork) => (w.matchNote?.includes('institution') ? 0 : 1);
      possible.sort((a, b) => rank(a) - rank(b));
      possibleMatches = mergeWorks(
        possible.filter((w) => isNew(w) && !(w.doi && confirmedDois.has(w.doi)) && !confirmedTitles.has(titleKey(w.title, w.year))),
      ).slice(0, MAX_POSSIBLE);
    } catch (err) {
      logger.warn({ error: String(err) }, 'De-duplicating extra matches failed');
      warnings.push('Could not check for extra papers right now.');
    }
  }

  return { author, total: oa.total, page, works, crossrefExtras, possibleMatches, warnings };
}
