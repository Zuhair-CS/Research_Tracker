import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { currentUser } from '../middleware/auth.js';
import { IdParam } from '../schemas/common.js';

/**
 * The logged-in user's own notifications.
 * SECURITY (object-level access): every query is scoped with
 * `userId: me.id`, so nobody can read or mark someone else's notifications,
 * even by guessing an id.
 */
export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notification.count({ where: { userId: me.id, readAt: null } }),
  ]);
  res.json({ items, unread });
});

notificationsRouter.get('/unread-count', async (req, res) => {
  res.json({ unread: await prisma.notification.count({ where: { userId: currentUser(req).id, readAt: null } }) });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const { count } = await prisma.notification.updateMany({
    where: { id, userId: currentUser(req).id, readAt: null },
    data: { readAt: new Date() },
  });
  if (count === 0 && !(await prisma.notification.count({ where: { id, userId: currentUser(req).id } }))) throw notFound();
  res.status(204).end();
});

notificationsRouter.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: currentUser(req).id, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
});
