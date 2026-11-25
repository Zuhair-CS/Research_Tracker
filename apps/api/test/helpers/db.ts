import { prisma } from '../../src/lib/db.js';
import { hashPassword } from '../../src/lib/password.js';
import type { PublicationType } from '../../src/generated/prisma/enums.js';

/** Password of every fixture account (test-only, never used anywhere real). */
export const PASSWORD = 'correct-horse-battery-staple';

let hash: Promise<string> | undefined;

/**
 * Wipe the test database and create a small, known set of fixtures:
 * two departments and one account per role (plus a second researcher and a
 * disabled account, for access-control tests).
 */
export async function resetDb() {
  const { resetRateLimits } = await import('./http.js');
  await resetRateLimits();
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "Notification", "ClaimRequest", "PublicationAuthor", "Publication", "User", "Department", "session" CASCADE',
  );
  hash ??= hashPassword(PASSWORD);
  const passwordHash = await hash;

  const cs = await prisma.department.create({ data: { code: 'CS', name: 'Computer Science' } });
  const ee = await prisma.department.create({ data: { code: 'EE', name: 'Electrical Engineering' } });

  const user = (email: string, name: string, data: Record<string, unknown>) =>
    prisma.user.create({ data: { email, name, passwordHash, ...data } });

  const users = {
    admin: await user('admin@test.edu', 'Ada Admin', { role: 'ADMIN' }),
    researcher: await user('aisha@test.edu', 'Aisha Rahman', { role: 'RESEARCHER', researcherType: 'FACULTY', departmentId: cs.id }),
    other: await user('bob@test.edu', 'Bob Kumar', { role: 'RESEARCHER', researcherType: 'STUDENT', departmentId: ee.id }),
    viewer: await user('viewer@test.edu', 'Vera Viewer', { role: 'VIEWER' }),
    disabled: await user('gone@test.edu', 'Gone User', { role: 'RESEARCHER', active: false, departmentId: cs.id }),
  };
  return { departments: { cs, ee }, users };
}

export type Fixtures = Awaited<ReturnType<typeof resetDb>>;

/** Insert a publication directly (bypassing the API) for read/permission tests. */
export async function createPublication(
  ownerId: string,
  departmentId: string,
  data: Partial<{ title: string; year: number; doi: string | null; type: PublicationType; venue: string; authors: string[]; openalexId: string }> = {},
) {
  const { authors = ['Aisha Rahman'], ...fields } = data;
  return prisma.publication.create({
    data: {
      title: 'A study of testing',
      year: 2024,
      type: 'JOURNAL_ARTICLE',
      ...fields,
      ownerId,
      departmentId,
      authors: { create: authors.map((name, position) => ({ name, position })) },
    },
  });
}

export { prisma };
