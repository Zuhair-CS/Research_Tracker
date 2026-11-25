/**
 * Development seed data: departments, one account per role and sample publications.
 *
 * SECURITY: account passwords are read from environment variables
 * (SEED_*_PASSWORD in .env) - they are never written in this file.
 * Run with: npm run db:seed
 */
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type PublicationType } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/lib/password.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  if (name.endsWith('_PASSWORD') && value.length < 12) throw new Error(`${name} must be at least 12 characters`);
  return value;
}

const pool = new pg.Pool({ connectionString: required('DATABASE_URL') });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DEPARTMENTS = [
  { code: 'CS', name: 'Computer Science' },
  { code: 'EE', name: 'Electrical Engineering' },
  { code: 'ME', name: 'Mechanical Engineering' },
  { code: 'BIO', name: 'Biology' },
  { code: 'MATH', name: 'Mathematics' },
  { code: 'PHY', name: 'Physics' },
];

// Fictional records. DOIs use 10.5555, Crossref's prefix reserved for testing.
const SAMPLE_PUBLICATIONS: {
  title: string;
  authors: string[];
  venue: string;
  year: number;
  type: PublicationType;
  dept: string;
  owner: 'faculty' | 'student';
  doi?: string;
}[] = [
  { title: 'Layered Security Scanning in Continuous Delivery Pipelines', authors: ['A. Rahman', 'S. Khan'], venue: 'Journal of Software Engineering', year: 2025, type: 'JOURNAL_ARTICLE', dept: 'CS', owner: 'faculty', doi: '10.5555/pb1.2025.001' },
  { title: 'Supply-Chain Attacks on Open Source Package Registries', authors: ['A. Rahman'], venue: 'IEEE Symposium on Security and Privacy', year: 2024, type: 'CONFERENCE_PAPER', dept: 'CS', owner: 'faculty', doi: '10.5555/pb1.2024.002' },
  { title: 'Container Image Hardening for University Research Platforms', authors: ['S. Khan', 'A. Rahman'], venue: 'ACM SIGCSE', year: 2024, type: 'CONFERENCE_PAPER', dept: 'CS', owner: 'student' },
  { title: 'A Survey of Static Application Security Testing Tools', authors: ['S. Khan'], venue: 'arXiv', year: 2025, type: 'PREPRINT', dept: 'CS', owner: 'student' },
  { title: 'Low-Power Sensor Networks for Smart Campuses', authors: ['A. Rahman', 'M. Ali'], venue: 'IEEE Sensors Journal', year: 2023, type: 'JOURNAL_ARTICLE', dept: 'EE', owner: 'faculty' },
  { title: 'Fault Detection in Power Grids Using Machine Learning', authors: ['A. Rahman'], venue: 'Energy Reports', year: 2022, type: 'JOURNAL_ARTICLE', dept: 'EE', owner: 'faculty' },
  { title: 'Thermal Analysis of Additively Manufactured Heat Sinks', authors: ['A. Rahman', 'J. Smith'], venue: 'Applied Thermal Engineering', year: 2023, type: 'JOURNAL_ARTICLE', dept: 'ME', owner: 'faculty' },
  { title: 'Gene Expression Patterns in Drought-Tolerant Wheat', authors: ['S. Khan', 'L. Chen'], venue: 'Plant Biology Reports', year: 2021, type: 'JOURNAL_ARTICLE', dept: 'BIO', owner: 'student' },
  { title: 'Introduction to Graph Theory for Engineers', authors: ['A. Rahman'], venue: 'University Press', year: 2020, type: 'BOOK', dept: 'MATH', owner: 'faculty' },
  { title: 'Spectral Methods for Sparse Matrices', authors: ['A. Rahman', 'P. Novak'], venue: 'Numerical Linear Algebra', year: 2024, type: 'BOOK_CHAPTER', dept: 'MATH', owner: 'faculty' },
  { title: 'Quantum Error Correction on Noisy Devices', authors: ['S. Khan'], venue: 'Physical Review A', year: 2025, type: 'JOURNAL_ARTICLE', dept: 'PHY', owner: 'student' },
  { title: 'Secure Software Delivery in Higher Education (MSc Thesis)', authors: ['S. Khan'], venue: 'Faculty of Computing', year: 2023, type: 'THESIS', dept: 'CS', owner: 'student' },
];

async function main(): Promise<void> {
  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({ where: { code: d.code }, update: { name: d.name }, create: d });
  }
  const dept = Object.fromEntries((await prisma.department.findMany()).map((d) => [d.code, d.id])) as Record<string, string>;

  const upsertUser = async (data: {
    email: string;
    name: string;
    password: string;
    role: 'ADMIN' | 'RESEARCHER' | 'VIEWER';
    researcherType?: 'FACULTY' | 'STUDENT';
    departmentId?: string;
  }) => {
    const { password, email, ...rest } = data;
    const passwordHash = await hashPassword(password);
    return prisma.user.upsert({
      where: { email },
      update: { ...rest, passwordHash, active: true },
      create: { ...rest, email, passwordHash },
    });
  };

  await upsertUser({ email: required('SEED_ADMIN_EMAIL'), name: 'System Administrator', password: required('SEED_ADMIN_PASSWORD'), role: 'ADMIN' });
  const faculty = await upsertUser({
    email: required('SEED_RESEARCHER_EMAIL'),
    name: 'Dr. Aisha Rahman',
    password: required('SEED_RESEARCHER_PASSWORD'),
    role: 'RESEARCHER',
    researcherType: 'FACULTY',
    departmentId: dept.CS,
  });
  // A second researcher (student) so ownership rules can be demonstrated. Same password as the first.
  const studentEmail = required('SEED_RESEARCHER_EMAIL').replace('@', '+student@');
  const student = await upsertUser({
    email: studentEmail,
    name: 'Sara Khan',
    password: required('SEED_RESEARCHER_PASSWORD'),
    role: 'RESEARCHER',
    researcherType: 'STUDENT',
    departmentId: dept.CS,
  });
  await upsertUser({ email: required('SEED_VIEWER_EMAIL'), name: 'Library Viewer', password: required('SEED_VIEWER_PASSWORD'), role: 'VIEWER' });

  if ((await prisma.publication.count()) === 0) {
    for (const p of SAMPLE_PUBLICATIONS) {
      await prisma.publication.create({
        data: {
          title: p.title,
          venue: p.venue,
          year: p.year,
          type: p.type,
          doi: p.doi ?? null,
          departmentId: dept[p.dept] as string,
          ownerId: p.owner === 'faculty' ? faculty.id : student.id,
          authors: { create: p.authors.map((name, position) => ({ name, position })) },
        },
      });
    }
  }

  console.log(`Seed complete. Accounts: admin, researcher (${faculty.email}), student (${studentEmail}), viewer.`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect().then(() => pool.end()));
