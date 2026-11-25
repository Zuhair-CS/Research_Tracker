import { Router } from 'express';
import { z } from 'zod';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { HttpError, badRequest, conflict } from '../lib/errors.js';
import { normalizeOrcid } from '../lib/identifiers.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { externalLookupLimiter } from '../middleware/rate-limit.js';
import { fetchWorkDetails, fetchWorkSummaries, type OrcidWork } from '../services/orcid.js';
import { publicationInclude, toPublicationDto } from '../services/publications.js';

const LinkBody = z.strictObject({
  orcidId: z
    .string()
    .max(60)
    .transform((value, ctx) => {
      const id = normalizeOrcid(value);
      if (!id) {
        ctx.addIssue({ code: 'custom', message: 'Not a valid ORCID iD (expected e.g. 0000-0002-1825-0097)' });
        return z.NEVER;
      }
      return id;
    }),
});

const ImportBody = z.strictObject({
  putCodes: z.array(z.string().regex(/^\d{1,15}$/)).min(1).max(100),
  departmentId: z.uuid().optional(),
});

/** Researchers only: ORCID linking and import always act on the caller's own account. */
export const orcidRouter = Router();
orcidRouter.use(requireRole('RESEARCHER'));

function requireLinkedOrcid(orcidId: string | null): string {
  if (!orcidId) throw new HttpError(400, 'ORCID_NOT_LINKED', 'Link your ORCID iD first');
  return orcidId;
}

/**
 * Link an ORCID iD to the logged-in researcher.
 * Note for the report: proving that the person really OWNS the iD needs
 * ORCID's OAuth sign-in (a registered client). This version checks the iD's
 * format, its check digit and that the public record exists, and the link is
 * recorded in the audit log, which is a reasonable level for read-only import.
 */
orcidRouter.put('/', externalLookupLimiter, async (req, res) => {
  const me = currentUser(req);
  const { orcidId } = LinkBody.parse(req.body);

  const taken = await prisma.user.findFirst({ where: { orcidId, NOT: { id: me.id } }, select: { id: true } });
  if (taken) throw conflict('This ORCID iD is already linked to another account');
  await fetchWorkSummaries(orcidId); // throws 404 if the record does not exist

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: me.id }, data: { orcidId } });
    await writeAudit(
      req,
      { action: AuditAction.ORCID_LINK, entityType: 'User', entityId: me.id, before: { orcidId: me.orcidId }, after: { orcidId } },
      tx,
    );
  });
  res.json({ orcidId });
});

orcidRouter.delete('/', async (req, res) => {
  const me = currentUser(req);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: me.id }, data: { orcidId: null } });
    await writeAudit(
      req,
      { action: AuditAction.ORCID_UNLINK, entityType: 'User', entityId: me.id, before: { orcidId: me.orcidId } },
      tx,
    );
  });
  res.status(204).end();
});

async function existingKeys(ownerId: string) {
  const mine = await prisma.publication.findMany({ where: { ownerId }, select: { doi: true, orcidPutCode: true } });
  return {
    dois: new Set(mine.map((p) => p.doi).filter((d): d is string => Boolean(d))),
    putCodes: new Set(mine.map((p) => p.orcidPutCode).filter((c): c is string => Boolean(c))),
  };
}

const isDuplicate = (w: OrcidWork, keys: Awaited<ReturnType<typeof existingKeys>>) =>
  keys.putCodes.has(w.putCode) || (w.doi !== null && keys.dois.has(w.doi));

/** Preview the works on the linked ORCID record, marking the ones already imported. */
orcidRouter.get('/works', externalLookupLimiter, async (req, res) => {
  const me = currentUser(req);
  const works = await fetchWorkSummaries(requireLinkedOrcid(me.orcidId));
  const keys = await existingKeys(me.id);
  res.json({ orcidId: me.orcidId, works: works.map((w) => ({ ...w, alreadyImported: isDuplicate(w, keys) })) });
});

/** Import the selected works as publications owned by the caller. Duplicates are skipped. */
orcidRouter.post('/import', externalLookupLimiter, async (req, res) => {
  const me = currentUser(req);
  const orcidId = requireLinkedOrcid(me.orcidId);
  const { putCodes, departmentId: requestedDept } = ImportBody.parse(req.body);

  const departmentId = requestedDept ?? me.departmentId;
  if (!departmentId) throw badRequest('Choose a department for the imported publications');
  if (!(await prisma.department.count({ where: { id: departmentId } }))) {
    throw badRequest('Unknown department', 'UNKNOWN_DEPARTMENT');
  }

  const works = await fetchWorkDetails(orcidId, [...new Set(putCodes)]);
  const keys = await existingKeys(me.id);
  const imported: ReturnType<typeof toPublicationDto>[] = [];
  const skipped: { putCode: string; title: string; reason: string }[] = [];

  for (const w of works) {
    if (isDuplicate(w, keys)) {
      skipped.push({ putCode: w.putCode, title: w.title, reason: 'Already in your publications' });
      continue;
    }
    if (!w.title || !w.year || w.year < 1900 || w.year > new Date().getFullYear() + 1) {
      skipped.push({ putCode: w.putCode, title: w.title, reason: 'Missing title or valid year on ORCID' });
      continue;
    }
    // ORCID data is untrusted too: clamp lengths to the same limits as manual entry.
    const authors = (w.authors.length ? w.authors : [me.name]).slice(0, 100).map((a) => a.slice(0, 200));
    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.publication.create({
        data: {
          title: w.title.slice(0, 500),
          venue: w.venue?.slice(0, 300) ?? null,
          year: w.year as number,
          doi: w.doi,
          type: w.type,
          source: 'ORCID',
          orcidPutCode: w.putCode,
          departmentId,
          ownerId: me.id,
          authors: { create: authors.map((name, position) => ({ name, position })) },
        },
        include: publicationInclude,
      });
      const dto = toPublicationDto(p);
      await writeAudit(req, { action: AuditAction.PUBLICATION_CREATE, entityType: 'Publication', entityId: p.id, after: dto }, tx);
      return dto;
    });
    keys.putCodes.add(w.putCode);
    if (w.doi) keys.dois.add(w.doi);
    imported.push(created);
  }

  await writeAudit(req, {
    action: AuditAction.ORCID_IMPORT,
    entityType: 'User',
    entityId: me.id,
    after: { orcidId, requested: putCodes.length, imported: imported.length, skipped: skipped.length },
  });
  res.json({ imported, skipped });
});
