import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import {
  EmailSchema,
  IdParam,
  NewPasswordSchema,
  Pagination,
  ResearcherTypeSchema,
  RoleSchema,
  optionalQuery,
} from '../schemas/common.js';
import { NotificationType, notify } from '../services/notifications.js';
import { getPublicationStats } from '../services/stats.js';
import { toSelfDto, userSelect } from '../services/users.js';

/**
 * Admin-only area: dashboard statistics, the audit log and user management.
 * SECURITY: the role check is applied once to the whole router, so no admin
 * route can be added without it.
 */
export const adminRouter = Router();
adminRouter.use(requireRole('ADMIN'));

adminRouter.get('/stats', async (_req, res) => {
  res.json(await getPublicationStats());
});

// ---------------------------------------------------------------- audit log
const AuditQuery = z.strictObject({
  action: optionalQuery(z.string().regex(/^[A-Z_]{1,40}$/)),
  entityType: optionalQuery(z.enum(['Publication', 'User', 'Session', 'Report', 'ClaimRequest'])),
  actorId: optionalQuery(z.uuid()),
  from: optionalQuery(z.coerce.date()),
  to: optionalQuery(z.coerce.date()),
  ...Pagination,
});

adminRouter.get('/audit-logs', async (req, res) => {
  const q = AuditQuery.parse(req.query);
  const where = {
    ...(q.action ? { action: q.action } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
  };
  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});

// ---------------------------------------------------------- user management
const CreateUserBody = z.strictObject({
  email: EmailSchema,
  name: z.string().trim().min(1).max(200),
  password: NewPasswordSchema,
  role: RoleSchema,
  researcherType: ResearcherTypeSchema.nullish(),
  departmentId: z.uuid().nullish(),
});

const UpdateUserBody = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    role: RoleSchema,
    researcherType: ResearcherTypeSchema.nullable(),
    departmentId: z.uuid().nullable(),
    active: z.boolean(),
  })
  .partial();

adminRouter.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({ select: userSelect, orderBy: { name: 'asc' } });
  res.json({ items: users.map(toSelfDto) });
});

adminRouter.post('/users', async (req, res) => {
  const body = CreateUserBody.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
    throw conflict('A user with this e-mail already exists');
  }
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: body.email,
        name: body.name,
        role: body.role,
        researcherType: body.role === 'RESEARCHER' ? (body.researcherType ?? null) : null,
        departmentId: body.departmentId ?? null,
        passwordHash: await hashPassword(body.password),
      },
      select: userSelect,
    });
    // The password is deliberately NOT written to the audit log.
    await writeAudit(req, { action: AuditAction.USER_CREATE, entityType: 'User', entityId: created.id, after: toSelfDto(created) }, tx);
    return created;
  });
  res.status(201).json(toSelfDto(user));
});

/**
 * Approve or reject the Faculty/Student access someone asked for at sign-up.
 * Approving turns the read-only Viewer into a Researcher of that type.
 */
const AccessDecision = z.strictObject({ decision: z.enum(['approve', 'reject']) });

adminRouter.post('/users/:id/access', async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const { decision } = AccessDecision.parse(req.body);

  const user = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: userSelect });
    if (!before) throw notFound('User not found');
    if (!before.pendingResearcherType) throw badRequest('This user has no access request waiting');
    const approved = decision === 'approve';
    const updated = await tx.user.update({
      where: { id },
      data: approved
        ? { role: 'RESEARCHER', researcherType: before.pendingResearcherType, pendingResearcherType: null }
        : { pendingResearcherType: null },
      select: userSelect,
    });
    await notify(
      [id],
      approved
        ? {
            type: NotificationType.ACCESS_APPROVED,
            message: `Your ${before.pendingResearcherType.toLowerCase()} access was approved. Start by importing your Google Scholar list, or add publications yourself.`,
            link: '/import/scholar',
          }
        : { type: NotificationType.ACCESS_REJECTED, message: 'Your researcher access request was not approved. You keep read-only access.' },
      tx,
    );
    await writeAudit(
      req,
      {
        action: approved ? AuditAction.ACCESS_APPROVE : AuditAction.ACCESS_REJECT,
        entityType: 'User',
        entityId: id,
        before: toSelfDto(before),
        after: toSelfDto(updated),
      },
      tx,
    );
    return updated;
  });
  res.json(toSelfDto(user));
});

adminRouter.patch('/users/:id', async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const body = UpdateUserBody.parse(req.body);
  const me = currentUser(req);

  // Stop an admin from locking everyone out by demoting or disabling themself.
  if (id === me.id && ((body.role && body.role !== 'ADMIN') || body.active === false)) {
    throw badRequest('You cannot remove your own admin access');
  }

  const user = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: userSelect });
    if (!before) throw notFound('User not found');
    const updated = await tx.user.update({ where: { id }, data: body, select: userSelect });
    // A disabled user is logged out everywhere straight away.
    if (body.active === false) await tx.session.deleteMany({ where: { sess: { path: ['userId'], equals: id } } });
    await writeAudit(
      req,
      { action: AuditAction.USER_UPDATE, entityType: 'User', entityId: id, before: toSelfDto(before), after: toSelfDto(updated) },
      tx,
    );
    return updated;
  });
  res.json(toSelfDto(user));
});
