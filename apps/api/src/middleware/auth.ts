import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../generated/prisma/enums.js';
import type { AuthUser } from '../types/express.js';
import { prisma } from '../lib/db.js';
import { forbidden, unauthorized } from '../lib/errors.js';

/**
 * Looks up the logged-in user on EVERY request.
 *
 * SECURITY: the session only stores the user id. The role and "active" flag
 * are read fresh from the database each time, so when an admin changes
 * someone's role or disables their account it takes effect immediately -
 * the user cannot keep old powers until their session expires.
 */
export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) return next();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      researcherType: true,
      departmentId: true,
      orcidId: true,
      openalexAuthorId: true,
      active: true,
    },
  });

  if (!user || !user.active) {
    // Account deleted or disabled: throw the session away.
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    return next();
  }

  const { active: _active, ...authUser } = user;
  req.user = authUser;
  next();
}

/**
 * SECURITY (deny by default): mounted in front of every /api route except
 * the few public ones (health, CSRF token, login). A new route is therefore
 * protected automatically, even if the developer forgets to add a check.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

/**
 * Role-based access control (RBAC). Example: requireRole('ADMIN').
 * The check runs on the server - hiding a button in the UI is NOT security,
 * because anyone can call the API directly with curl or Postman.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Returns the logged-in user inside a handler (already guaranteed by requireAuth). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
