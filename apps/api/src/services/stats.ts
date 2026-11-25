import { prisma } from '../lib/db.js';

/** Publication counts for the admin dashboard. All grouping is done by the database. */
export async function getPublicationStats() {
  const [total, researchers, byDept, byYear, byType, departments] = await Promise.all([
    prisma.publication.count(),
    prisma.user.count({ where: { role: 'RESEARCHER', active: true } }),
    prisma.publication.groupBy({ by: ['departmentId'], _count: { _all: true } }),
    prisma.publication.groupBy({ by: ['year'], _count: { _all: true }, orderBy: { year: 'asc' } }),
    prisma.publication.groupBy({ by: ['type'], _count: { _all: true } }),
    prisma.department.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  const deptCounts = new Map(byDept.map((d) => [d.departmentId, d._count._all]));
  return {
    totals: { publications: total, researchers },
    byDepartment: departments.map((d) => ({ code: d.code, name: d.name, count: deptCounts.get(d.id) ?? 0 })),
    byYear: byYear.map((y) => ({ year: y.year, count: y._count._all })),
    byType: byType.map((t) => ({ type: t.type, count: t._count._all })).sort((a, b) => b.count - a.count),
  };
}
