import { Router, type Request } from 'express';
import { z } from 'zod';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { config } from '../config/env.js';
import { HttpError, badRequest, conflict } from '../lib/errors.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../lib/password.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { loginLimiter, signupLimiter } from '../middleware/rate-limit.js';
import { SESSION_COOKIE_NAME } from '../middleware/session.js';
import { EmailSchema, NewPasswordSchema, ResearcherTypeSchema } from '../schemas/common.js';
import { NotificationType, notifyAdmins } from '../services/notifications.js';
import { toSelfDto, userSelect } from '../services/users.js';

const LoginBody = z.strictObject({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

const ChangePasswordBody = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: NewPasswordSchema,
});

const SignupBody = z.strictObject({
  name: z.string().trim().min(2).max(200),
  email: EmailSchema,
  password: NewPasswordSchema,
  researcherType: ResearcherTypeSchema,
  departmentId: z.uuid(),
});

const regenerate =(req: Request) =>
  new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
const save = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

export const authRouter = Router();

/** Public: gives the browser a CSRF token for its (possibly new, anonymous) session. */
authRouter.get('/csrf', (req, res) => {
  res.json({ csrfToken: issueCsrfToken(req) });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = LoginBody.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email }, select: { ...userSelect, passwordHash: true } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : await verifyAgainstDummy(password);

  if (!user || !valid || !user.active) {
    await writeAudit(req, {
      action: AuditAction.LOGIN_FAILED,
      entityType: 'Session',
      actorId: user?.id ?? null,
      after: { email, reason: !user ? 'unknown_email' : !valid ? 'wrong_password' : 'account_disabled' },
    });
    // SECURITY: one generic message for every failure, so attackers cannot
    // tell whether an e-mail is registered or an account is disabled.
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // SECURITY (session fixation): issue a brand-new session ID at login, so an
  // ID an attacker may have planted before login becomes worthless.
  await regenerate(req);
  req.session.userId = user.id;
  const csrfToken = issueCsrfToken(req);
  await save(req);

  await writeAudit(req, { action: AuditAction.LOGIN, entityType: 'Session', actorId: user.id });
  const { passwordHash: _hash, ...profile } = user;
  res.json({ user: toSelfDto(profile), csrfToken });
});

authRouter.post('/logout', async (req, res) => {
  const userId = req.session.userId;
  await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  if (userId) await writeAudit(req, { action: AuditAction.LOGOUT, entityType: 'Session', actorId: userId });
  res.status(204).end();
});

/** Public: what the sign-up form needs (no personal data). */
authRouter.get('/signup-options', async (_req, res) => {
  res.json({
    enabled: config.SIGNUP_ENABLED,
    allowedDomains: config.SIGNUP_ALLOWED_DOMAINS,
    departments: await prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  });
});

/**
 * Self-service sign-up.
 *
 * SECURITY:
 *  - A new account is always a read-only VIEWER. The Faculty/Student access the
 *    person asks for is stored as "pending" and only an admin can grant it, so
 *    signing up can never give anyone the power to add or change data.
 *  - Optional e-mail domain allow-list (e.g. only @upes.ac.in).
 *  - Rate limited (5 per IP per hour), same password rules and hashing as everywhere.
 *  - Mass assignment is impossible: the body has no "role" field (strictObject).
 */
authRouter.post('/signup', signupLimiter, async (req, res) => {
  if (!config.SIGNUP_ENABLED) throw new HttpError(403, 'SIGNUP_DISABLED', 'Sign-up is turned off. Ask an administrator.');
  const body = SignupBody.parse(req.body);

  const domain = body.email.split('@')[1] ?? '';
  if (config.SIGNUP_ALLOWED_DOMAINS.length && !config.SIGNUP_ALLOWED_DOMAINS.includes(domain)) {
    throw badRequest(`Use your university e-mail (${config.SIGNUP_ALLOWED_DOMAINS.map((d) => `@${d}`).join(', ')})`, 'EMAIL_DOMAIN_NOT_ALLOWED');
  }
  if (!(await prisma.department.count({ where: { id: body.departmentId } }))) throw badRequest('Unknown department', 'UNKNOWN_DEPARTMENT');
  if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
    throw conflict('An account with this e-mail already exists. Try signing in.');
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        role: 'VIEWER',
        pendingResearcherType: body.researcherType,
        departmentId: body.departmentId,
      },
      select: userSelect,
    });
    await notifyAdmins(
      {
        type: NotificationType.SIGNUP_PENDING,
        message: `${created.name} (${created.email}) signed up and asks for ${body.researcherType.toLowerCase()} access.`,
        link: '/admin/users',
      },
      tx,
    );
    await writeAudit(req, { action: AuditAction.USER_SIGNUP, entityType: 'User', entityId: created.id, actorId: created.id, after: toSelfDto(created) }, tx);
    return created;
  });

  // Sign the new user in straight away (new session id, as at login).
  await regenerate(req);
  req.session.userId = user.id;
  const csrfToken = issueCsrfToken(req);
  await save(req);
  res.status(201).json({ user: toSelfDto(user), csrfToken });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id }, select: userSelect });
  res.json({ user: toSelfDto(user) });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const { currentPassword, newPassword } = ChangePasswordBody.parse(req.body);
  if (currentPassword === newPassword) throw badRequest('The new password must be different');

  const { passwordHash } = await prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(passwordHash, currentPassword))) {
    throw new HttpError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(newPassword) } });
    // SECURITY: log out every other device. If the password was changed
    // because it leaked, the attacker's existing session dies too.
    await tx.session.deleteMany({ where: { sess: { path: ['userId'], equals: me.id } } });
    await writeAudit(req, { action: AuditAction.PASSWORD_CHANGE, entityType: 'User', entityId: me.id }, tx);
  });

  // The current session was deleted above; give this browser a fresh one.
  await regenerate(req);
  req.session.userId = me.id;
  const csrfToken = issueCsrfToken(req);
  await save(req);
  res.json({ csrfToken });
});
