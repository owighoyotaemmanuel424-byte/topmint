import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method === 'GET') {
    const rows = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return res.status(200).json({ notifications: rows });
  }
  if (req.method === 'PATCH') {
    const id = typeof req.body?.id === 'string' ? req.body.id : null;
    if (!id) return res.status(400).json({ error: 'Notification id is required' });
    const updated = await prisma.notification.updateMany({ where: { id, userId: user.id }, data: { read: true } });
    return res.status(200).json({ updated: updated.count });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
