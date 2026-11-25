import type { Prisma } from '../generated/prisma/client.js';

export const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  researcherType: true,
  pendingResearcherType: true,
  orcidId: true,
  openalexAuthorId: true,
  active: true,
  createdAt: true,
  department: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/**
 * Full profile, including personal data (e-mail, ORCID iD).
 * SECURITY: only returned to the user themself or to an Admin. Everyone else
 * only ever sees a researcher's name and department (see publicationInclude).
 */
export function toSelfDto(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    researcherType: u.researcherType,
    // Faculty/Student access the user asked for at sign-up, waiting for admin approval.
    pendingResearcherType: u.pendingResearcherType,
    orcidId: u.orcidId,
    openalexAuthorId: u.openalexAuthorId,
    active: u.active,
    createdAt: u.createdAt,
    department: u.department,
  };
}
