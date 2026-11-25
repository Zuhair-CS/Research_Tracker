import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/db.js';

type Db = Pick<Prisma.TransactionClient, 'notification' | 'user'>;

export const NotificationType = {
  CLAIM_REQUEST: 'CLAIM_REQUEST',
  CLAIM_APPROVED: 'CLAIM_APPROVED',
  CLAIM_REJECTED: 'CLAIM_REJECTED',
  CLAIM_CANCELLED: 'CLAIM_CANCELLED',
  SIGNUP_PENDING: 'SIGNUP_PENDING',
  ACCESS_APPROVED: 'ACCESS_APPROVED',
  ACCESS_REJECTED: 'ACCESS_REJECTED',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

interface NewNotification {
  type: NotificationType;
  message: string;
  /** In-app path only (e.g. "/claims/123"), never an external URL. */
  link?: string;
}

export async function notify(userIds: string[], n: NewNotification, db: Db = prisma): Promise<void> {
  if (userIds.length === 0) return;
  await db.notification.createMany({
    data: userIds.map((userId) => ({ userId, type: n.type, message: n.message.slice(0, 500), link: n.link ?? null })),
  });
}

export async function notifyAdmins(n: NewNotification, db: Db = prisma): Promise<void> {
  const admins = await db.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } });
  await notify(
    admins.map((a) => a.id),
    n,
    db,
  );
}
