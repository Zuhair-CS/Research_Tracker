import { Router } from 'express';
import { currentUser, requireRole } from '../middleware/auth.js';
import { externalLookupLimiter } from '../middleware/rate-limit.js';
import { IdParam } from '../schemas/common.js';
import { DoiLookupQuery, PublicationInput, PublicationQuery } from '../schemas/publication.js';
import { lookupDoi } from '../services/crossref.js';
import { prisma } from '../lib/db.js';
import {
  createPublication,
  deletePublication,
  getPublication,
  listPublications,
  updatePublication,
} from '../services/publications.js';

export const publicationsRouter = Router();

// Any logged-in role (Admin, Researcher, Viewer) may browse and search.
publicationsRouter.get('/', async (req, res) => {
  res.json(await listPublications(PublicationQuery.parse(req.query), currentUser(req)));
});

/**
 * DOI auto-fill: asks Crossref for the publication's details. Only roles that
 * can create publications may use it (stops Viewers using our server as a proxy).
 */
publicationsRouter.get('/lookup/doi', requireRole('RESEARCHER', 'ADMIN'), externalLookupLimiter, async (req, res) => {
  const { doi } = DoiLookupQuery.parse(req.query);
  const draft = await lookupDoi(doi);
  const duplicate = await prisma.publication.findFirst({
    where: { ownerId: currentUser(req).id, doi: draft.doi },
    select: { id: true },
  });
  res.json({ draft, alreadyAddedId: duplicate?.id ?? null });
});

publicationsRouter.get('/:id', async (req, res) => {
  const { id } = IdParam.parse(req.params);
  res.json(await getPublication(id, currentUser(req)));
});

// Only researchers create publications; they always become the owner.
publicationsRouter.post('/', requireRole('RESEARCHER'), async (req, res) => {
  const input = PublicationInput.parse(req.body);
  res.status(201).json(await createPublication(req, currentUser(req), input));
});

// Role check here, ownership check inside the service (researcher must own it; admin may edit any).
publicationsRouter.put('/:id', requireRole('RESEARCHER', 'ADMIN'), async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const input = PublicationInput.parse(req.body);
  res.json(await updatePublication(req, currentUser(req), id, input));
});

publicationsRouter.delete('/:id', requireRole('RESEARCHER', 'ADMIN'), async (req, res) => {
  const { id } = IdParam.parse(req.params);
  await deletePublication(req, currentUser(req), id);
  res.status(204).end();
});
