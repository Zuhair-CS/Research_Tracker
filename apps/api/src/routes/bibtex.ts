import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { AuditAction, writeAudit } from '../lib/audit.js';
import { BIBTEX_LIMITS } from '../lib/bibtex.js';
import { prisma } from '../lib/db.js';
import { badRequest } from '../lib/errors.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rate-limit.js';
import { optionalQuery } from '../schemas/common.js';
import { analyseBibtex, importBibtex } from '../services/bibtex-import.js';

/**
 * Import publications from a BibTeX file (e.g. a Google Scholar profile export).
 *
 * SECURITY:
 *  - Researchers only, and only into their OWN account (the owner comes from
 *    the session, never from the request).
 *  - The file is sent as plain text with a 1 MB cap, separate from the 100 KB
 *    JSON limit used everywhere else; anything that is not text/plain is ignored.
 *  - Uploads are rate-limited per user, because parsing large files costs CPU.
 *  - Nothing the browser says about an entry is trusted: the import step
 *    re-reads the uploaded file and only accepts entry numbers.
 */
export const bibtexRouter = Router();
bibtexRouter.use(requireRole('RESEARCHER'));

const readText = express.text({ type: 'text/plain', limit: BIBTEX_LIMITS.maxBytes });

function uploadedText(req: Request): string {
  if (typeof req.body !== 'string' || !req.body.trim()) {
    throw badRequest('Upload a BibTeX (.bib) file as plain text', 'BIBTEX_EMPTY');
  }
  return req.body;
}

const ImportQuery = z.strictObject({
  // Entry numbers to import, e.g. "0,1,5".
  select: z
    .string()
    .max(6000)
    .regex(/^\d{1,4}(,\d{1,4})*$/, 'Expected entry numbers, e.g. 0,1,5')
    .transform((s) => [...new Set(s.split(',').map(Number))]),
  departmentId: optionalQuery(z.uuid()),
});

/** Step 1: read the file and show what would be imported. Nothing is saved. */
bibtexRouter.post('/preview', uploadLimiter, readText, async (req, res) => {
  res.json(await analyseBibtex(uploadedText(req), currentUser(req).id));
});

/** Step 2: import the selected entries into the caller's account. */
bibtexRouter.post('/', uploadLimiter, readText, async (req, res) => {
  const me = currentUser(req);
  const { select, departmentId: requested } = ImportQuery.parse(req.query);
  const text = uploadedText(req);

  const departmentId = requested ?? me.departmentId;
  if (!departmentId) throw badRequest('Choose a department for the imported publications');
  if (!(await prisma.department.count({ where: { id: departmentId } }))) throw badRequest('Unknown department', 'UNKNOWN_DEPARTMENT');

  const result = await importBibtex(req, me, departmentId, text, select);
  await writeAudit(req, {
    action: AuditAction.BIBTEX_IMPORT,
    entityType: 'User',
    entityId: me.id,
    after: { requested: select.length, imported: result.imported.length, skipped: result.skipped.length },
  });
  res.json(result);
});
