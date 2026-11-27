import type { Request } from 'express';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './db.js';

/** Every action that is written to the audit log. */
export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PUBLICATION_CREATE: 'PUBLICATION_CREATE',
  PUBLICATION_UPDATE: 'PUBLICATION_UPDATE',
  PUBLICATION_DELETE: 'PUBLICATION_DELETE',
  ORCID_LINK: 'ORCID_LINK',
  ORCID_UNLINK: 'ORCID_UNLINK',
  ORCID_IMPORT: 'ORCID_IMPORT',
  OPENALEX_IMPORT: 'OPENALEX_IMPORT',
  BIBTEX_IMPORT: 'BIBTEX_IMPORT',
  USER_SIGNUP: 'USER_SIGNUP',
  ACCESS_APPROVE: 'ACCESS_APPROVE',
  ACCESS_REJECT: 'ACCESS_REJECT',
  CLAIM_REQUEST: 'CLAIM_REQUEST',
  CLAIM_APPROVE: 'CLAIM_APPROVE',
  CLAIM_REJECT: 'CLAIM_REJECT',
  CLAIM_CANCEL: 'CLAIM_CANCEL',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  REPORT_EXPORT: 'REPORT_EXPORT',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Either the shared client or a transaction client, so audit rows can be written atomically. */
type DbClient = Pick<Prisma.TransactionClient, 'auditLog'>;

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Write one audit log row: who (actor), did what (action), to which record
 * (entity), the record before/after the change, and from where (IP + browser).
 *
 * SECURITY (non-repudiation): call this inside the same database transaction
 * as the change itself, so a change can never be saved without its audit
 * record. Callers must never pass secrets (passwords, hashes) in before/after.
 */
export async function writeAudit(req: Request, entry: AuditEntry, db: DbClient = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      actorId: entry.actorId === undefined ? (req.user?.id ?? null) : entry.actorId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      ip: req.ip ?? null,
      userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  // Round-trip through JSON so Dates become strings and the value is plain data.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
