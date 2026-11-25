export type Role = 'ADMIN' | 'RESEARCHER' | 'VIEWER';
export type ResearcherType = 'FACULTY' | 'STUDENT';
export type PublicationType =
  | 'JOURNAL_ARTICLE'
  | 'CONFERENCE_PAPER'
  | 'BOOK'
  | 'BOOK_CHAPTER'
  | 'THESIS'
  | 'PREPRINT'
  | 'OTHER';

export const PUBLICATION_TYPES: { value: PublicationType; label: string }[] = [
  { value: 'JOURNAL_ARTICLE', label: 'Journal article' },
  { value: 'CONFERENCE_PAPER', label: 'Conference paper' },
  { value: 'BOOK', label: 'Book' },
  { value: 'BOOK_CHAPTER', label: 'Book chapter' },
  { value: 'THESIS', label: 'Thesis' },
  { value: 'PREPRINT', label: 'Preprint' },
  { value: 'OTHER', label: 'Other' },
];
export const typeLabel = (t: PublicationType) => PUBLICATION_TYPES.find((p) => p.value === t)?.label ?? t;

export interface Department {
  id: string;
  code: string;
  name: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  researcherType: ResearcherType | null;
  pendingResearcherType: ResearcherType | null;
  orcidId: string | null;
  openalexAuthorId: string | null;
  active: boolean;
  createdAt: string;
  department: Department | null;
}

export interface Publication {
  id: string;
  title: string;
  authors: string[];
  venue: string | null;
  year: number;
  doi: string | null;
  type: PublicationType;
  pdfUrl: string | null;
  source: 'MANUAL' | 'CROSSREF' | 'ORCID';
  department: Department;
  owner: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PublicationDraft {
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  doi: string;
  type: PublicationType;
  pdfUrl: string | null;
}

export interface OrcidWork {
  putCode: string;
  title: string;
  venue: string | null;
  year: number | null;
  doi: string | null;
  type: PublicationType;
  alreadyImported: boolean;
}

export interface Stats {
  totals: { publications: number; researchers: number };
  byDepartment: { code: string; name: string; count: number }[];
  byYear: { year: number; count: number }[];
  byType: { type: PublicationType; count: number }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

// ---------------------------------------------------------------- Find research
export interface LinkedUser {
  id: string;
  name: string;
}

export interface ExternalAuthor {
  id: string;
  name: string;
  orcidId: string | null;
  worksCount: number;
  citedByCount: number;
  institutions: string[];
  linkedUser?: LinkedUser | null;
}

export interface ScholarlyWork {
  openalexId: string | null;
  doi: string | null;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  type: PublicationType;
  pdfUrl: string | null;
  citedByCount: number;
  openAccess: boolean;
  sources: ('openalex' | 'crossref')[];
  alreadyImported: boolean;
}

export const workKey = (w: Pick<ScholarlyWork, 'openalexId' | 'doi'>) => w.openalexId ?? `doi:${w.doi}`;

export interface PeopleResult {
  total: number;
  page: number;
  perPage: number;
  authors: ExternalAuthor[];
}

export interface ResearcherWorks {
  author: ExternalAuthor;
  total: number;
  page: number;
  perPage: number;
  works: ScholarlyWork[];
  crossrefExtras: ScholarlyWork[];
  linkedUser: LinkedUser | null;
  warnings: string[];
}

export interface PublicationResults {
  works: ScholarlyWork[];
  page: number;
  perPage: number;
  totals: { openalex: number; crossref: number };
  warnings: string[];
}

// ---------------------------------------------------------------- Claims & notifications
export type ClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface ClaimWork {
  key: string;
  openalexId: string | null;
  doi: string | null;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  type: PublicationType;
  citedByCount: number;
  alreadyImported?: boolean;
}

export interface Claim {
  id: string;
  openalexAuthorId: string | null;
  authorName: string;
  authorInstitution: string | null;
  message: string | null;
  status: ClaimStatus;
  responseNote: string | null;
  importedCount: number;
  createdAt: string;
  respondedAt: string | null;
  researcher: { id: string; name: string; email: string; department: { code: string } | null };
  requestedBy: { id: string; name: string };
  works?: ClaimWork[];
}

export interface AppNotification {
  id: string;
  type: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
