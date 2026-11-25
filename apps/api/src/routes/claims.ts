import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { externalLookupLimiter } from '../middleware/rate-limit.js';
import { IdParam, optionalQuery } from '../schemas/common.js';
import { lookupDoi } from '../services/crossref.js';
import { importWorks } from '../services/importer.js';
import { NotificationType, notify } from '../services/notifications.js';
import { AUTHOR_ID, MAX_EXTRA_PROFILES, getAuthorWorks, getWorksByIds } from '../services/openalex.js';
import type { ScholarlyWork, WorkRef } from '../services/scholarly-types.js';
import { WorkRefSchema } from './discover.js';

/**
 * Claim requests: "Admin found this profile/these papers - are they yours?"
 *
 * Flow: ADMIN creates a request for a registered RESEARCHER -> the researcher
 * gets a notification -> they review the paper list, untick anything that is
 * not theirs, and APPROVE (papers are imported into their account) or REJECT.
 *
 * SECURITY / privacy:
 *  - Nothing is written to a researcher's profile without their consent.
 *  - Only the named researcher can approve/reject; anyone else gets 404 (not
 *    403), so request ids cannot be probed.
 *  - The paper data is re-fetched from OpenAlex/Crossref on the server, never
 *    taken from the browser.
 *  - Approval uses an atomic status change, so double-clicking or two tabs
 *    cannot import twice.
 */
export const claimsRouter = Router();

const MAX_WORKS = 200;

interface SnapshotWork {
  key: string;
  openalexId: string | null;
  doi: string | null;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  type: string;
  citedByCount: number;
}

const toSnapshot = (w: ScholarlyWork): SnapshotWork => ({
  key: w.openalexId ?? `doi:${w.doi}`,
  openalexId: w.openalexId,
  doi: w.doi,
  title: w.title,
  authors: w.authors.slice(0, 10),
  venue: w.venue,
  year: w.year,
  type: w.type,
  citedByCount: w.citedByCount,
});

/**
 * Fetch the offered papers from their sources (never trust titles sent by the browser).
 * `profileIds` set = include the whole profile(s); `refs` = individually ticked papers.
 */
async function buildSnapshot(profileIds: string[], refs: WorkRef[]): Promise<SnapshotWork[]> {
  const works = await fetchRefs(refs);
  if (profileIds.length > 0) {
    // Whole profile(s): the most recent MAX_WORKS papers.
    works.push(...(await getAuthorWorks(profileIds, { sort: 'newest' }, 1, MAX_WORKS)).works);
  }
  // Ticked papers come first, so they survive the MAX_WORKS cut; duplicates are dropped.
  const seen = new Set<string>();
  return works
    .map(toSnapshot)
    .filter((w) => !seen.has(w.key) && Boolean(seen.add(w.key)))
    .slice(0, MAX_WORKS);
}

async function fetchRefs(refs: WorkRef[]): Promise<ScholarlyWork[]> {
  const ids = refs.map((r) => r.openalexId).filter((id): id is string => Boolean(id));
  const dois = refs.filter((r) => !r.openalexId && r.doi).map((r) => r.doi as string);
  const works: ScholarlyWork[] = [];
  for (let i = 0; i < ids.length; i += 50) works.push(...(await getWorksByIds(ids.slice(i, i + 50))));
  for (const doi of dois) {
    const d = await lookupDoi(doi).catch(() => null);
    if (d) works.push({ ...d, openalexId: null, citedByCount: 0, openAccess: false, sources: ['crossref'] });
  }
  return works;
}

const CreateBody = z.strictObject({
  researcherId: z.uuid(),
  openalexAuthorId: z.string().regex(AUTHOR_ID).optional(),
  authorName: z.string().trim().min(1).max(200),
  authorInstitution: z.string().trim().max(300).optional(),
  // Other OpenAlex profiles of the same person, included with "whole profile".
  alsoAuthorIds: z.array(z.string().regex(AUTHOR_ID)).max(MAX_EXTRA_PROFILES).default([]),
  // Send every paper on the profile(s), plus any ticked `works`. Default: only when no works are ticked.
  wholeProfile: z.boolean().optional(),
  works: z.array(WorkRefSchema).max(MAX_WORKS).default([]),
  message: z.string().trim().max(500).optional(),
});

const ApproveBody = z.strictObject({
  // The papers the researcher kept ticked (keys from the snapshot). Omitted = all of them.
  keys: z.array(z.string().max(300)).max(MAX_WORKS).optional(),
  departmentId: z.uuid().optional(),
});

const RejectBody = z.strictObject({ note: z.string().trim().max(500).optional() });
const ListQuery = z.strictObject({ status: optionalQuery(z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])) });

const claimInclude = {
  researcher: { select: { id: true, name: true, email: true, department: { select: { code: true } } } },
  requestedBy: { select: { id: true, name: true } },
} satisfies Prisma.ClaimRequestInclude;

/** Admins see every request; a researcher sees only requests addressed to them. */
function visibleTo(user: ReturnType<typeof currentUser>): Prisma.ClaimRequestWhereInput {
  return user.role === 'ADMIN' ? {} : { researcherId: user.id };
}

claimsRouter.post('/', requireRole('ADMIN'), externalLookupLimiter, async (req, res) => {
  const me = currentUser(req);
  const body = CreateBody.parse(req.body);

  const researcher = await prisma.user.findUnique({
    where: { id: body.researcherId },
    select: { id: true, name: true, role: true, active: true, openalexAuthorId: true },
  });
  if (!researcher || researcher.role !== 'RESEARCHER' || !researcher.active) {
    throw badRequest('Requests can only be sent to an active researcher account', 'INVALID_RESEARCHER');
  }
  if (body.openalexAuthorId) {
    const linked = await prisma.user.findFirst({
      where: { openalexAuthorId: body.openalexAuthorId, NOT: { id: researcher.id } },
      select: { name: true },
    });
    if (linked) throw conflict(`This profile is already confirmed by ${linked.name}`);
    const pending = await prisma.claimRequest.count({
      where: { researcherId: researcher.id, openalexAuthorId: body.openalexAuthorId, status: 'PENDING' },
    });
    if (pending) throw conflict('A request for this profile is already waiting for this researcher');
  }

  const whole = body.wholeProfile ?? body.works.length === 0;
  if (whole && !body.openalexAuthorId) throw badRequest('Select papers, or send the whole profile');
  if (body.alsoAuthorIds.length && !body.openalexAuthorId) throw badRequest('Other profiles need a main profile');
  const profileIds = whole && body.openalexAuthorId ? [body.openalexAuthorId, ...body.alsoAuthorIds] : [];
  const works = await buildSnapshot(profileIds, body.works);
  if (works.length === 0) throw badRequest('No papers were found to send');

  const claim = await prisma.$transaction(async (tx) => {
    const created = await tx.claimRequest.create({
      data: {
        researcherId: researcher.id,
        requestedById: me.id,
        openalexAuthorId: body.openalexAuthorId ?? null,
        authorName: body.authorName,
        authorInstitution: body.authorInstitution ?? null,
        message: body.message ?? null,
        works: works as unknown as Prisma.InputJsonValue,
      },
      include: claimInclude,
    });
    await notify(
      [researcher.id],
      {
        type: NotificationType.CLAIM_REQUEST,
        message: `${me.name} found ${works.length} paper(s) under "${body.authorName}" and asks you to confirm they are yours.`,
        link: `/claims/${created.id}`,
      },
      tx,
    );
    await writeAudit(
      req,
      {
        action: AuditAction.CLAIM_REQUEST,
        entityType: 'ClaimRequest',
        entityId: created.id,
        after: {
          researcher: researcher.name,
          authorName: body.authorName,
          openalexAuthorId: body.openalexAuthorId,
          alsoAuthorIds: body.alsoAuthorIds,
          works: works.length,
        },
      },
      tx,
    );
    return created;
  });
  res.status(201).json(claim);
});

claimsRouter.get('/', requireRole('ADMIN', 'RESEARCHER'), async (req, res) => {
  const { status } = ListQuery.parse(req.query);
  const items = await prisma.claimRequest.findMany({
    where: { ...visibleTo(currentUser(req)), ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: claimInclude,
    omit: { works: true },
  });
  res.json({ items });
});

claimsRouter.get('/:id', requireRole('ADMIN', 'RESEARCHER'), async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const claim = await prisma.claimRequest.findFirst({ where: { id, ...visibleTo(currentUser(req)) }, include: claimInclude });
  if (!claim) throw notFound('Request not found');
  // Mark papers the researcher already has, so they are not imported twice.
  const have = await prisma.publication.findMany({ where: { ownerId: claim.researcherId }, select: { doi: true, openalexId: true } });
  const dois = new Set(have.map((h) => h.doi).filter(Boolean));
  const ids = new Set(have.map((h) => h.openalexId).filter(Boolean));
  const works = (claim.works as unknown as SnapshotWork[]).map((w) => ({
    ...w,
    alreadyImported: Boolean((w.doi && dois.has(w.doi)) || (w.openalexId && ids.has(w.openalexId))),
  }));
  res.json({ ...claim, works });
});

claimsRouter.post('/:id/approve', requireRole('RESEARCHER'), externalLookupLimiter, async (req, res) => {
  const me = currentUser(req);
  const { id } = IdParam.parse(req.params);
  const body = ApproveBody.parse(req.body);

  const claim = await prisma.claimRequest.findFirst({ where: { id, researcherId: me.id } });
  if (!claim) throw notFound('Request not found');
  if (claim.status !== 'PENDING') throw conflict('This request has already been answered');

  const snapshot = claim.works as unknown as SnapshotWork[];
  const keep = body.keys ? new Set(body.keys) : null;
  const chosen = snapshot.filter((w) => !keep || keep.has(w.key));
  if (chosen.length === 0) throw badRequest('Tick at least one paper, or reject the request');

  const departmentId = body.departmentId ?? me.departmentId;
  if (!departmentId) throw badRequest('Choose a department for the imported publications');
  if (!(await prisma.department.count({ where: { id: departmentId } }))) throw badRequest('Unknown department', 'UNKNOWN_DEPARTMENT');

  // Atomically move PENDING -> APPROVED. If another click got here first, count is 0.
  const { count } = await prisma.claimRequest.updateMany({
    where: { id, researcherId: me.id, status: 'PENDING' },
    data: { status: 'APPROVED', respondedAt: new Date() },
  });
  if (count === 0) throw conflict('This request has already been answered');

  let result;
  try {
    result = await importWorks(
      req,
      me,
      departmentId,
      chosen.map((w) => ({ openalexId: w.openalexId ?? undefined, doi: w.doi ?? undefined })),
    );
  } catch (err) {
    // Import failed (e.g. OpenAlex down): put the request back so it can be retried.
    await prisma.claimRequest.update({ where: { id }, data: { status: 'PENDING', respondedAt: null } });
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.claimRequest.update({ where: { id }, data: { importedCount: result.imported.length } });
    // Remember the confirmed profile, unless the researcher already confirmed a different one.
    if (claim.openalexAuthorId && !me.openalexAuthorId) {
      const takenBy = await tx.user.count({ where: { openalexAuthorId: claim.openalexAuthorId } });
      if (!takenBy) await tx.user.update({ where: { id: me.id }, data: { openalexAuthorId: claim.openalexAuthorId } });
    }
    await notify(
      [claim.requestedById],
      {
        type: NotificationType.CLAIM_APPROVED,
        message: `${me.name} confirmed "${claim.authorName}": ${result.imported.length} paper(s) added to their profile.`,
        link: `/claims/${id}`,
      },
      tx,
    );
    await writeAudit(
      req,
      {
        action: AuditAction.CLAIM_APPROVE,
        entityType: 'ClaimRequest',
        entityId: id,
        after: { offered: snapshot.length, kept: chosen.length, imported: result.imported.length, skipped: result.skipped.length },
      },
      tx,
    );
  });
  res.json(result);
});

claimsRouter.post('/:id/reject', requireRole('RESEARCHER'), async (req, res) => {
  const me = currentUser(req);
  const { id } = IdParam.parse(req.params);
  const { note } = RejectBody.parse(req.body);
  const claim = await prisma.claimRequest.findFirst({ where: { id, researcherId: me.id } });
  if (!claim) throw notFound('Request not found');

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.claimRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', respondedAt: new Date(), responseNote: note ?? null },
    });
    if (count === 0) throw conflict('This request has already been answered');
    await notify(
      [claim.requestedById],
      {
        type: NotificationType.CLAIM_REJECTED,
        message: `${me.name} said "${claim.authorName}" is not them${note ? `: ${note}` : '.'}`,
        link: `/claims/${id}`,
      },
      tx,
    );
    await writeAudit(req, { action: AuditAction.CLAIM_REJECT, entityType: 'ClaimRequest', entityId: id, after: { note } }, tx);
  });
  res.status(204).end();
});

claimsRouter.post('/:id/cancel', requireRole('ADMIN'), async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const claim = await prisma.claimRequest.findUnique({ where: { id } });
  if (!claim) throw notFound('Request not found');
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.claimRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
    if (count === 0) throw conflict('Only waiting requests can be cancelled');
    await notify(
      [claim.researcherId],
      { type: NotificationType.CLAIM_CANCELLED, message: `The request about "${claim.authorName}" was withdrawn by an admin.` },
      tx,
    );
    await writeAudit(req, { action: AuditAction.CLAIM_CANCEL, entityType: 'ClaimRequest', entityId: id }, tx);
  });
  res.status(204).end();
});
