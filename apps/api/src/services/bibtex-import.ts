import type { Request } from 'express';
import type { PublicationType } from '../generated/prisma/enums.js';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { latexToText, parseBibtex, splitAuthors, type BibEntry, type BibProblem } from '../lib/bibtex.js';
import { prisma } from '../lib/db.js';
import { normalizeDoi } from '../lib/identifiers.js';
import { titleKey } from '../lib/names.js';
import { PublicationInput } from '../schemas/publication.js';
import { publicationInclude, toPublicationDto } from './publications.js';

/**
 * "Import from Google Scholar": a researcher exports their own Scholar profile
 * as BibTeX and uploads it here.
 *
 * Two steps, both re-reading the uploaded file on the server:
 *  1. analyse - parse, validate and mark duplicates; NOTHING is saved;
 *  2. import  - save only the entries the researcher ticked, into their OWN account.
 * Every entry passes the same validation as a publication typed in by hand.
 */

export type CandidateStatus = 'new' | 'duplicate' | 'invalid';

export interface BibCandidate {
  index: number;
  line: number;
  key: string;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  doi: string | null;
  type: PublicationType;
  pdfUrl: string | null;
  status: CandidateStatus;
  reason?: string;
}

/** BibTeX entry type -> our publication type. */
export function mapBibType(entry: BibEntry): PublicationType {
  const venue = `${entry.fields.journal ?? ''} ${entry.fields.howpublished ?? ''}`.toLowerCase();
  switch (entry.type) {
    case 'article':
      // Scholar exports arXiv preprints as articles in "arXiv preprint arXiv:...".
      return /arxiv|biorxiv|medrxiv|ssrn|preprint/.test(venue) ? 'PREPRINT' : 'JOURNAL_ARTICLE';
    case 'inproceedings':
    case 'conference':
      return 'CONFERENCE_PAPER';
    case 'book':
    case 'proceedings':
      return 'BOOK';
    case 'incollection':
    case 'inbook':
      return 'BOOK_CHAPTER';
    case 'phdthesis':
    case 'mastersthesis':
    case 'thesis':
      return 'THESIS';
    case 'unpublished':
      return 'PREPRINT';
    default:
      return /arxiv|biorxiv|medrxiv|ssrn|preprint/.test(venue) || entry.fields.eprint ? 'PREPRINT' : 'OTHER';
  }
}

/** One BibTeX entry -> a candidate publication (not yet checked against the account). */
export function toCandidate(entry: BibEntry, index: number): BibCandidate {
  const f = entry.fields;
  const clean = (v: string | undefined) => (v ? latexToText(v) : '');
  const year = /\b(1[89]\d{2}|20\d{2})\b/.exec(f.year ?? f.date ?? '');
  const doiSource = f.doi ?? [f.url, f.eprint, f.note].find((v) => v && /10\.\d{4,9}\//.test(v)) ?? '';
  const doiMatch = /10\.\d{4,9}\/[^\s,{}"]+/.exec(doiSource);
  const url = clean(f.url);

  const candidate: BibCandidate = {
    index,
    line: entry.line,
    key: entry.key,
    title: clean(f.title),
    authors: f.author ? splitAuthors(f.author) : f.editor ? splitAuthors(f.editor) : [],
    venue: clean(f.journal ?? f.booktitle ?? f.school ?? f.institution ?? f.publisher ?? f.howpublished) || null,
    year: year ? Number(year[1]) : null,
    doi: doiMatch ? normalizeDoi(doiMatch[0].replace(/[.)\]]+$/, '')) : null,
    type: mapBibType(entry),
    // Only a direct https link to a PDF is kept (same rule as manual entry).
    pdfUrl: /^https:\/\/\S+\.pdf$/i.test(url) ? url : null,
    status: 'new',
  };

  // Clear reasons for the most common gaps in Scholar exports first...
  const missing = !candidate.title ? 'No title' : !candidate.year ? 'No year' : candidate.authors.length === 0 ? 'No authors' : null;
  if (missing) return { ...candidate, status: 'invalid', reason: missing };
  // ...then exactly the same validation as a publication typed in by hand.
  const check = PublicationInput.safeParse({
    title: candidate.title,
    authors: candidate.authors,
    venue: candidate.venue,
    year: candidate.year,
    doi: candidate.doi,
    type: candidate.type,
    pdfUrl: candidate.pdfUrl,
    departmentId: '00000000-0000-4000-8000-000000000000', // placeholder: the real one is checked at import
  });
  if (!check.success) {
    const issue = check.error.issues[0];
    return { ...candidate, status: 'invalid', reason: `Invalid ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'not accepted'}` };
  }
  return candidate;
}

export interface BibAnalysis {
  candidates: BibCandidate[];
  errors: BibProblem[];
  stats: { entries: number; new: number; duplicate: number; invalid: number };
}

/** Parse the file and mark which entries are new, duplicates or invalid for this account. */
export async function analyseBibtex(text: string, ownerId: string): Promise<BibAnalysis> {
  const { entries, errors } = parseBibtex(text);
  const existing = await prisma.publication.findMany({ where: { ownerId }, select: { doi: true, title: true, year: true } });
  const haveDoi = new Set(existing.map((p) => p.doi).filter(Boolean));
  const haveTitle = new Set(existing.map((p) => titleKey(p.title, p.year)));
  const seenDoi = new Set<string>();
  const seenTitle = new Set<string>();

  const candidates = entries.map((entry, index) => {
    const c = toCandidate(entry, index);
    if (c.status === 'invalid') return c;
    const tKey = titleKey(c.title, c.year);
    if ((c.doi && haveDoi.has(c.doi)) || haveTitle.has(tKey)) return { ...c, status: 'duplicate' as const, reason: 'Already in your publications' };
    if ((c.doi && seenDoi.has(c.doi)) || seenTitle.has(tKey)) return { ...c, status: 'duplicate' as const, reason: 'Listed twice in the file' };
    if (c.doi) seenDoi.add(c.doi);
    seenTitle.add(tKey);
    return c;
  });

  const count = (s: CandidateStatus) => candidates.filter((c) => c.status === s).length;
  return { candidates, errors, stats: { entries: candidates.length, new: count('new'), duplicate: count('duplicate'), invalid: count('invalid') } };
}

export interface BibImportResult {
  imported: ReturnType<typeof toPublicationDto>[];
  skipped: { index: number; title: string; reason: string }[];
}

/**
 * Save the selected entries (by index in the file) for the owner. The file is
 * analysed again here, so only entries that are new and valid are saved,
 * whatever the browser sent.
 */
export async function importBibtex(
  req: Request,
  owner: { id: string },
  departmentId: string,
  text: string,
  select: number[],
): Promise<BibImportResult> {
  const { candidates } = await analyseBibtex(text, owner.id);
  const wanted = new Set(select);
  const result: BibImportResult = { imported: [], skipped: [] };

  for (const c of candidates) {
    if (!wanted.has(c.index)) continue;
    if (c.status !== 'new') {
      result.skipped.push({ index: c.index, title: c.title, reason: c.reason ?? 'Not importable' });
      continue;
    }
    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.publication.create({
        data: {
          title: c.title,
          venue: c.venue,
          year: c.year as number,
          doi: c.doi,
          type: c.type,
          pdfUrl: c.pdfUrl,
          source: 'BIBTEX',
          departmentId,
          ownerId: owner.id,
          authors: { create: c.authors.map((name, position) => ({ name, position })) },
        },
        include: publicationInclude,
      });
      const dto = toPublicationDto(p);
      await writeAudit(req, { action: AuditAction.PUBLICATION_CREATE, entityType: 'Publication', entityId: p.id, after: dto }, tx);
      return dto;
    });
    result.imported.push(created);
  }
  return result;
}
