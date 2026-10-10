import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';
import { NOTIFICATION_PUBLIC_SELECT, serializeNotification } from '../../../lib/notifications';

// PATCH /api/notifications/[id] — mark one notification as read.
//
// Ownership is part of the update predicate, so a notification id belonging to
// another customer simply does not match. There is no endpoint that lets a
// customer change anything else about a notification, and none that lets them
// create one: notifications only ever come from trusted server operations.
export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id || id.length > 64) return res.status(400).json({ error: 'A notification id is required.' });

    const updated = await prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { read: true, readAt: new Date() },
    });
    if (updated.count === 0) return res.status(404).json({ error: 'That notification could not be found.' });

    const [notification, unread] = await prisma.$transaction([
      prisma.notification.findUnique({ where: { id }, select: NOTIFICATION_PUBLIC_SELECT }),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
    ]);

    return res.status(200).json({ notification: serializeNotification(notification), unread });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'NOTIFICATION_UPDATE_FAILED',
      message: 'Unable to update that notification right now. Please try again shortly.',
    });
  }
}
