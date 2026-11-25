import type { Request } from 'express';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { normalizeDoi } from '../lib/identifiers.js';
import { lookupDoi } from './crossref.js';
import { getWorksByIds, WORK_ID } from './openalex.js';
import { publicationInclude, toPublicationDto } from './publications.js';
import type { ScholarlyWork, WorkRef } from './scholarly-types.js';

export interface ImportOwner {
  id: string;
  name: string;
}

export interface ImportResult {
  imported: ReturnType<typeof toPublicationDto>[];
  skipped: { ref: WorkRef; title: string; reason: string }[];
}

/**
 * Re-fetch the referenced works from their source and save them as
 * publications owned by `owner`.
 *
 * SECURITY: the browser only sends ids/DOIs. The publication data itself is
 * always fetched again here on the server, so a user cannot import made-up
 * titles or authors by editing the request. External data is still treated as
 * untrusted: lengths are clamped and only https PDF links are kept.
 */
export async function importWorks(req: Request, owner: ImportOwner, departmentId: string, refs: WorkRef[]): Promise<ImportResult> {
  const result: ImportResult = { imported: [], skipped: [] };

  // 1. Fetch details: OpenAlex ids in batches of 50, DOI-only refs from Crossref.
  const openalexIds = [...new Set(refs.map((r) => r.openalexId).filter((id): id is string => Boolean(id && WORK_ID.test(id))))];
  const dois = [
    ...new Set(
      refs
        .filter((r) => !r.openalexId && r.doi)
        .map((r) => normalizeDoi(r.doi as string))
        .filter((d): d is string => Boolean(d)),
    ),
  ];

  const works: ScholarlyWork[] = [];
  for (let i = 0; i < openalexIds.length; i += 50) works.push(...(await getWorksByIds(openalexIds.slice(i, i + 50))));
  for (let i = 0; i < dois.length; i += 4) {
    const batch = await Promise.allSettled(dois.slice(i, i + 4).map((d) => lookupDoi(d)));
    batch.forEach((r, j) => {
      if (r.status === 'fulfilled') {
        works.push({ ...r.value, openalexId: null, citedByCount: 0, openAccess: false, sources: ['crossref'] });
      } else {
        result.skipped.push({ ref: { doi: dois[i + j] }, title: '', reason: 'Not found in Crossref' });
      }
    });
  }

  // 2. Skip anything the owner already has (same DOI or same OpenAlex work).
  const existing = await prisma.publication.findMany({ where: { ownerId: owner.id }, select: { doi: true, openalexId: true } });
  const haveDoi = new Set(existing.map((e) => e.doi).filter(Boolean));
  const haveOa = new Set(existing.map((e) => e.openalexId).filter(Boolean));
  const maxYear = new Date().getFullYear() + 1;

  for (const w of works) {
    const ref: WorkRef = { openalexId: w.openalexId ?? undefined, doi: w.doi ?? undefined };
    if ((w.doi && haveDoi.has(w.doi)) || (w.openalexId && haveOa.has(w.openalexId))) {
      result.skipped.push({ ref, title: w.title, reason: 'Already in this account' });
      continue;
    }
    if (!w.title || !w.year || w.year < 1900 || w.year > maxYear) {
      result.skipped.push({ ref, title: w.title, reason: 'Missing title or valid year' });
      continue;
    }
    const authors = (w.authors.length ? w.authors : [owner.name]).slice(0, 100).map((a) => a.slice(0, 200));
    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.publication.create({
        data: {
          title: w.title.slice(0, 500),
          venue: w.venue?.slice(0, 300) ?? null,
          year: w.year as number,
          doi: w.doi,
          type: w.type,
          pdfUrl: w.pdfUrl && w.pdfUrl.startsWith('https://') && w.pdfUrl.length <= 2048 ? w.pdfUrl : null,
          source: w.openalexId ? 'OPENALEX' : 'CROSSREF',
          openalexId: w.openalexId,
          departmentId,
          ownerId: owner.id,
          authors: { create: authors.map((name, position) => ({ name, position })) },
        },
        include: publicationInclude,
      });
      const dto = toPublicationDto(p);
      await writeAudit(req, { action: AuditAction.PUBLICATION_CREATE, entityType: 'Publication', entityId: p.id, after: dto }, tx);
      return dto;
    });
    if (w.doi) haveDoi.add(w.doi);
    if (w.openalexId) haveOa.add(w.openalexId);
    result.imported.push(created);
  }
  return result;
}
