import { Router } from 'express';
import { z } from 'zod';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { normalizeDoi, normalizeOrcid, orcidShape } from '../lib/identifiers.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { externalLookupLimiter } from '../middleware/rate-limit.js';
import { PublicationTypeSchema, optionalQuery } from '../schemas/common.js';
import { importWorks } from '../services/importer.js';
import { fetchOrcidRecord, type OrcidWork } from '../services/orcid.js';
import {
  AUTHOR_ID,
  MAX_EXTRA_PROFILES,
  WORK_ID,
  findRelatedAuthors,
  getAuthor,
  getAuthorByOrcid,
  getInstitutionName,
  searchAuthors,
} from '../services/openalex.js';
import { getResearcherWorks, searchPublications } from '../services/scholarly-search.js';
import type { ScholarlyWork } from '../services/scholarly-types.js';

/**
 * "Find research": search external catalogues (OpenAlex + Crossref) for
 * people and publications.
 *  - Every logged-in role may SEARCH (read-only, nothing is stored).
 *  - Only RESEARCHERS may IMPORT, and only into their OWN account.
 *  - Admins put papers into a researcher's account only with that
 *    researcher's consent, through a claim request (routes/claims.ts).
 * All external calls are rate-limited per user.
 */
export const discoverRouter = Router();

const bool = optionalQuery(z.enum(['true', 'false'])).transform((v) => v === 'true');
const year = optionalQuery(z.coerce.number().int().min(1900).max(2100));
const page = optionalQuery(z.coerce.number().int().min(1).max(200)).transform((v) => v ?? 1);
const scope = optionalQuery(z.enum(['institution', 'all'])).transform((v) => v ?? 'institution');

const WorkFiltersQuery = {
  yearFrom: year,
  yearTo: year,
  type: optionalQuery(PublicationTypeSchema),
  oaOnly: bool,
  sort: optionalQuery(z.enum(['relevance', 'newest', 'citations'])).transform((v) => v ?? 'relevance'),
};

const PeopleQuery = z.strictObject({
  q: optionalQuery(z.string().trim().min(2, 'Type at least 2 characters').max(100)),
  scope,
  sort: optionalQuery(z.enum(['relevance', 'works', 'citations'])).transform((v) => v ?? 'relevance'),
  hasOrcid: bool,
  page,
});

/** `?also=A1,A2`: other OpenAlex profiles of the same person to merge into the list. */
const alsoProfiles = optionalQuery(z.string().max(400))
  .transform((v) => (v ? v.split(',').filter(Boolean) : []))
  .pipe(z.array(z.string().regex(AUTHOR_ID, 'Invalid OpenAlex author id')).max(MAX_EXTRA_PROFILES));

const ResearcherWorksQuery = z.strictObject({ ...WorkFiltersQuery, page, ownerId: optionalQuery(z.uuid()), also: alsoProfiles });
const AuthorIdParam = z.strictObject({ authorId: z.string().regex(AUTHOR_ID, 'Invalid OpenAlex author id') });

/** Which of these OpenAlex profiles are already confirmed by a registered account. */
async function linkedUsers(authorIds: string[]) {
  const linked = await prisma.user.findMany({
    where: { openalexAuthorId: { in: authorIds } },
    select: { id: true, name: true, openalexAuthorId: true },
  });
  return new Map(linked.map((u) => [u.openalexAuthorId, { id: u.id, name: u.name }]));
}

const PublicationsQuery = z.strictObject({
  q: optionalQuery(z.string().trim().min(2).max(200)),
  author: optionalQuery(z.string().trim().min(2).max(100)),
  scope,
  sources: optionalQuery(z.enum(['both', 'openalex', 'crossref'])).transform((v) => v ?? 'both'),
  ...WorkFiltersQuery,
  page,
});

export const WorkRefSchema = z
  .strictObject({
    openalexId: z.string().regex(WORK_ID, 'Invalid OpenAlex work id').optional(),
    doi: z
      .string()
      .max(250)
      .optional()
      .transform((d) => (d ? (normalizeDoi(d) ?? undefined) : undefined)),
  })
  .refine((r) => r.openalexId || r.doi, 'Each work needs an OpenAlex id or a DOI');

const ImportBody = z.strictObject({
  works: z.array(WorkRefSchema).min(1).max(50),
  departmentId: z.uuid().optional(),
});

/** Adds `alreadyImported` for the account the user is acting for. */
async function markImported<T extends ScholarlyWork>(works: T[], ownerId: string | undefined) {
  if (!ownerId) return works.map((w) => ({ ...w, alreadyImported: false }));
  const rows = await prisma.publication.findMany({ where: { ownerId }, select: { doi: true, openalexId: true } });
  const dois = new Set(rows.map((r) => r.doi).filter(Boolean));
  const ids = new Set(rows.map((r) => r.openalexId).filter(Boolean));
  return works.map((w) => ({ ...w, alreadyImported: Boolean((w.doi && dois.has(w.doi)) || (w.openalexId && ids.has(w.openalexId))) }));
}

discoverRouter.get('/config', async (_req, res) => {
  res.json({ institution: await getInstitutionName() });
});

const orcidToWork = (w: OrcidWork): ScholarlyWork => ({
  openalexId: null,
  doi: w.doi,
  title: w.title,
  authors: w.authors,
  venue: w.venue,
  year: w.year,
  type: w.type,
  pdfUrl: null,
  citedByCount: 0,
  openAccess: false,
  sources: ['orcid'],
});

/** People search (OpenAlex). Empty query + our institution = browse all its researchers. */
discoverRouter.get('/people', externalLookupLimiter, async (req, res) => {
  const q = PeopleQuery.parse(req.query);
  const me = currentUser(req);

  // Search by ORCID iD.
  if (q.q && orcidShape(q.q)) {
    const orcidId = normalizeOrcid(q.q);
    // Looks like an ORCID iD but the check digit is wrong: almost always a typo.
    if (!orcidId) {
      throw new HttpError(400, 'INVALID_ORCID', 'This ORCID iD is not valid. Check it for a typo: the last character is a check digit (0-9 or X).');
    }
    const author = await getAuthorByOrcid(orcidId);
    if (author) {
      const byAuthor = await linkedUsers([author.id]);
      res.json({ total: 1, page: 1, perPage: 25, authors: [{ ...author, linkedUser: byAuthor.get(author.id) ?? null }] });
      return;
    }
    // Many researchers (especially with few papers) have an ORCID iD that no
    // OpenAlex profile is linked to. Fall back to the public ORCID record, and
    // suggest OpenAlex profiles with the same name.
    const record = await fetchOrcidRecord(orcidId);
    if (!record) throw new HttpError(404, 'ORCID_NOT_FOUND', 'No ORCID record exists for this iD.');
    const similar = record.name
      ? await searchAuthors({ q: record.name, onlyOurInstitution: q.scope === 'institution', hasOrcid: false, sort: 'relevance', page: 1, perPage: 25 })
      : { total: 0, authors: [] };
    const byAuthor = await linkedUsers(similar.authors.map((a) => a.id));
    const ownerId = me.role === 'RESEARCHER' ? me.id : undefined;
    res.json({
      total: similar.authors.length, // first 25 same-name suggestions only (no paging in this mode)
      page: 1,
      perPage: 25,
      authors: similar.authors.map((a) => ({ ...a, linkedUser: byAuthor.get(a.id) ?? null })),
      orcidRecord: { orcidId, name: record.name, works: await markImported(record.works.map(orcidToWork), ownerId) },
    });
    return;
  }
  if (!q.q && q.scope === 'all') throw badRequest('Type a name, or limit the search to your university to browse it');
  const result = await searchAuthors({
    q: q.q,
    onlyOurInstitution: q.scope === 'institution',
    hasOrcid: q.hasOrcid,
    sort: q.sort,
    page: q.page,
    perPage: 25,
  });
  // Show which results are already linked to a registered account (helps admins send claim requests).
  const byAuthor = await linkedUsers(result.authors.map((a) => a.id));
  res.json({ ...result, page: q.page, perPage: 25, authors: result.authors.map((a) => ({ ...a, linkedUser: byAuthor.get(a.id) ?? null })) });
});

/** Other OpenAlex profiles that may be the same person (split profiles, other spellings). */
discoverRouter.get('/people/:authorId/related', externalLookupLimiter, async (req, res) => {
  const { authorId } = AuthorIdParam.parse(req.params);
  const profiles = await findRelatedAuthors(await getAuthor(authorId));
  const byAuthor = await linkedUsers(profiles.map((p) => p.id));
  res.json({ profiles: profiles.map((p) => ({ ...p, linkedUser: byAuthor.get(p.id) ?? null })) });
});

/** One researcher's papers: OpenAlex profile(s) + Crossref extras + possible matches, with filters. */
discoverRouter.get('/people/:authorId/works', externalLookupLimiter, async (req, res) => {
  const { authorId } = AuthorIdParam.parse(req.params);
  const q = ResearcherWorksQuery.parse(req.query);
  const me = currentUser(req);
  const result = await getResearcherWorks(
    [authorId, ...q.also.filter((id) => id !== authorId)],
    { yearFrom: q.yearFrom, yearTo: q.yearTo, type: q.type, openAccessOnly: q.oaOnly, sort: q.sort },
    q.page,
  );
  // Researchers always see "imported" relative to their own account; admins can pick an account.
  const ownerId = me.role === 'RESEARCHER' ? me.id : me.role === 'ADMIN' ? q.ownerId : undefined;
  const linkedUser = await prisma.user.findFirst({ where: { openalexAuthorId: authorId }, select: { id: true, name: true } });
  res.json({
    ...result,
    perPage: 50,
    linkedUser,
    works: await markImported(result.works, ownerId),
    crossrefExtras: await markImported(result.crossrefExtras, ownerId),
    possibleMatches: await markImported(result.possibleMatches, ownerId),
  });
});

/** Publication search across OpenAlex + Crossref, merged and de-duplicated. */
discoverRouter.get('/works', externalLookupLimiter, async (req, res) => {
  const q = PublicationsQuery.parse(req.query);
  if (!q.q && !q.author && q.scope === 'all') {
    throw badRequest('Type keywords or an author name, or limit the search to your university to browse it');
  }
  const me = currentUser(req);
  const result = await searchPublications({
    q: q.q,
    author: q.author,
    onlyOurInstitution: q.scope === 'institution',
    useOpenAlex: q.sources !== 'crossref',
    useCrossref: q.sources !== 'openalex',
    yearFrom: q.yearFrom,
    yearTo: q.yearTo,
    type: q.type,
    openAccessOnly: q.oaOnly,
    sort: q.sort,
    page: q.page,
  });
  res.json({ ...result, works: await markImported(result.works, me.role === 'RESEARCHER' ? me.id : undefined) });
});

/** Researchers import selected papers into their own account. */
discoverRouter.post('/import', requireRole('RESEARCHER'), externalLookupLimiter, async (req, res) => {
  const me = currentUser(req);
  const { works, departmentId: requested } = ImportBody.parse(req.body);
  const departmentId = requested ?? me.departmentId;
  if (!departmentId) throw badRequest('Choose a department for the imported publications');
  if (!(await prisma.department.count({ where: { id: departmentId } }))) throw badRequest('Unknown department', 'UNKNOWN_DEPARTMENT');

  const result = await importWorks(req, me, departmentId, works);
  await writeAudit(req, {
    action: AuditAction.OPENALEX_IMPORT,
    entityType: 'User',
    entityId: me.id,
    after: { owner: me.name, requested: works.length, imported: result.imported.length, skipped: result.skipped.length },
  });
  res.json(result);
});
