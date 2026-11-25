import { Router, type Response } from 'express';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { PublicationQuery } from '../schemas/publication.js';
import { findPublicationsForExport } from '../services/publications.js';
import { getPublicationStats } from '../services/stats.js';

export const reportsRouter = Router();

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // "attachment" makes the browser download the file instead of rendering it.
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Any logged-in role can export the publication list (with the same filters
 * as the search page). SECURITY: the export contains only bibliographic
 * data and the owner's name - no e-mail addresses or other personal data.
 * Every export is recorded in the audit log.
 */
reportsRouter.get('/publications.csv', async (req, res) => {
  const query = PublicationQuery.parse(req.query);
  const rows = await findPublicationsForExport(query, currentUser(req));
  const csv = toCsv(
    ['Title', 'Authors', 'Journal / Conference', 'Year', 'DOI', 'Type', 'Department', 'PDF link', 'Added by', 'Source'],
    rows.map((p) => [
      p.title,
      p.authors.join('; '),
      p.venue,
      p.year,
      p.doi,
      p.type,
      p.department.name,
      p.pdfUrl,
      p.owner.name,
      p.source,
    ]),
  );
  const { page: _p, pageSize: _ps, ...filters } = query;
  await writeAudit(req, { action: AuditAction.REPORT_EXPORT, entityType: 'Report', entityId: 'publications.csv', after: { filters, rows: rows.length } });
  sendCsv(res, `publications-${today()}.csv`, csv);
});

/** Summary counts (the dashboard numbers) - admin only. */
reportsRouter.get('/summary.csv', requireRole('ADMIN'), async (req, res) => {
  const stats = await getPublicationStats();
  const rows: unknown[][] = [
    ...stats.byDepartment.map((d) => ['Department', d.name, d.count]),
    ...stats.byYear.map((y) => ['Year', y.year, y.count]),
    ...stats.byType.map((t) => ['Type', t.type, t.count]),
  ];
  await writeAudit(req, { action: AuditAction.REPORT_EXPORT, entityType: 'Report', entityId: 'summary.csv' });
  sendCsv(res, `publication-summary-${today()}.csv`, toCsv(['Category', 'Value', 'Publications'], rows));
});
