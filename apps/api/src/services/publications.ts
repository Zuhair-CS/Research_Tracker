import type { Request } from 'express';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../types/express.js';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { PublicationInput, PublicationQuery } from '../schemas/publication.js';

export const publicationInclude = {
  authors: { orderBy: { position: 'asc' }, select: { name: true } },
  department: { select: { id: true, code: true, name: true } },
  // SECURITY (personal data): only the owner's id and display name are
  // loaded - never their e-mail address - so it cannot leak by accident.
  owner: { select: { id: true, name: true } },
} satisfies Prisma.PublicationInclude;

type PublicationRow = Prisma.PublicationGetPayload<{ include: typeof publicationInclude }>;

export function toPublicationDto(p: PublicationRow) {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors.map((a) => a.name),
    venue: p.venue,
    year: p.year,
    doi: p.doi,
    type: p.type,
    pdfUrl: p.pdfUrl,
    source: p.source,
    department: p.department,
    owner: p.owner,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Ownership rule (object-level access control):
 *  - Admins may change any publication.
 *  - Researchers may change only the publications they own.
 *  - Viewers may never change anything.
 * SECURITY: without this check any researcher could edit another's record
 * just by changing the id in the URL (OWASP API1: Broken Object Level Authorization).
 */
export function canModify(user: AuthUser, publication: { ownerId: string }): boolean {
  if (user.role === 'ADMIN') return true;
  return user.role === 'RESEARCHER' && publication.ownerId === user.id;
}

export function buildWhere(query: PublicationQuery, user: AuthUser): Prisma.PublicationWhereInput {
  const and: Prisma.PublicationWhereInput[] = [];
  const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

  if (query.q) {
    and.push({
      OR: [
        { title: contains(query.q) },
        { venue: contains(query.q) },
        { doi: contains(query.q) },
        { authors: { some: { name: contains(query.q) } } },
      ],
    });
  }
  if (query.author) and.push({ authors: { some: { name: contains(query.author) } } });
  if (query.departmentId) and.push({ departmentId: query.departmentId });
  if (query.type) and.push({ type: query.type });
  if (query.year) and.push({ year: query.year });
  if (query.yearFrom) and.push({ year: { gte: query.yearFrom } });
  if (query.yearTo) and.push({ year: { lte: query.yearTo } });
  if (query.mine) and.push({ ownerId: user.id });

  return and.length ? { AND: and } : {};
}

const ORDER_BY: Record<PublicationQuery['sort'], Prisma.PublicationOrderByWithRelationInput[]> = {
  year_desc: [{ year: 'desc' }, { title: 'asc' }],
  year_asc: [{ year: 'asc' }, { title: 'asc' }],
  title_asc: [{ title: 'asc' }],
  created_desc: [{ createdAt: 'desc' }],
};

export async function listPublications(query: PublicationQuery, user: AuthUser) {
  const where = buildWhere(query, user);
  const [total, rows] = await prisma.$transaction([
    prisma.publication.count({ where }),
    prisma.publication.findMany({
      where,
      include: publicationInclude,
      orderBy: ORDER_BY[query.sort],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map((p) => ({ ...toPublicationDto(p), canEdit: canModify(user, p) })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** For the CSV export: same filters, no paging, but capped so one request cannot exhaust memory. */
export const EXPORT_LIMIT = 10_000;
export async function findPublicationsForExport(query: PublicationQuery, user: AuthUser) {
  const rows = await prisma.publication.findMany({
    where: buildWhere(query, user),
    include: publicationInclude,
    orderBy: ORDER_BY[query.sort],
    take: EXPORT_LIMIT,
  });
  return rows.map(toPublicationDto);
}

export async function getPublication(id: string, user: AuthUser) {
  const p = await prisma.publication.findUnique({ where: { id }, include: publicationInclude });
  if (!p) throw notFound('Publication not found');
  return { ...toPublicationDto(p), canEdit: canModify(user, p) };
}

async function assertDepartmentExists(tx: Prisma.TransactionClient, departmentId: string): Promise<void> {
  const exists = await tx.department.count({ where: { id: departmentId } });
  if (!exists) throw badRequest('Unknown department', 'UNKNOWN_DEPARTMENT');
}

async function assertDoiNotDuplicate(
  tx: Prisma.TransactionClient,
  ownerId: string,
  doi: string | null,
  exceptId?: string,
): Promise<void> {
  if (!doi) return;
  const existing = await tx.publication.findFirst({
    where: { ownerId, doi, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing) throw conflict('You already have a publication with this DOI');
}

const authorRows = (authors: string[]) => authors.map((name, position) => ({ name, position }));

export async function createPublication(req: Request, user: AuthUser, input: PublicationInput) {
  return prisma.$transaction(async (tx) => {
    await assertDepartmentExists(tx, input.departmentId);
    await assertDoiNotDuplicate(tx, user.id, input.doi);
    const { authors, ...fields } = input;
    const created = await tx.publication.create({
      data: { ...fields, ownerId: user.id, authors: { create: authorRows(authors) } },
      include: publicationInclude,
    });
    const dto = toPublicationDto(created);
    await writeAudit(
      req,
      { action: AuditAction.PUBLICATION_CREATE, entityType: 'Publication', entityId: created.id, after: dto },
      tx,
    );
    return { ...dto, canEdit: true };
  });
}

export async function updatePublication(req: Request, user: AuthUser, id: string, input: PublicationInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.publication.findUnique({ where: { id }, include: publicationInclude });
    if (!existing) throw notFound('Publication not found');
    if (!canModify(user, existing)) throw forbidden('You can only edit your own publications');

    await assertDepartmentExists(tx, input.departmentId);
    await assertDoiNotDuplicate(tx, existing.ownerId, input.doi, id);
    const { authors, source: _source, ...fields } = input;
    await tx.publicationAuthor.deleteMany({ where: { publicationId: id } });
    const updated = await tx.publication.update({
      where: { id },
      data: { ...fields, authors: { create: authorRows(authors) } },
      include: publicationInclude,
    });
    const after = toPublicationDto(updated);
    await writeAudit(
      req,
      {
        action: AuditAction.PUBLICATION_UPDATE,
        entityType: 'Publication',
        entityId: id,
        before: toPublicationDto(existing),
        after,
      },
      tx,
    );
    return { ...after, canEdit: true };
  });
}

export async function deletePublication(req: Request, user: AuthUser, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.publication.findUnique({ where: { id }, include: publicationInclude });
    if (!existing) throw notFound('Publication not found');
    if (!canModify(user, existing)) throw forbidden('You can only delete your own publications');

    await tx.publication.delete({ where: { id } });
    await writeAudit(
      req,
      { action: AuditAction.PUBLICATION_DELETE, entityType: 'Publication', entityId: id, before: toPublicationDto(existing) },
      tx,
    );
  });
}
