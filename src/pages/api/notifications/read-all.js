import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';

// POST /api/notifications/read-all — mark every unread notification as read.
//
// Scoped to the authenticated customer. Marking everything read is idempotent:
// a second call matches nothing and reports 0 updated rather than failing.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const updated = await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true, readAt: new Date() },
    });

    return res.status(200).json({ updated: updated.count, unread: 0 });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'NOTIFICATION_UPDATE_FAILED',
      message: 'Unable to update your notifications right now. Please try again shortly.',
    });
  }
}
