import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';
import { NOTIFICATION_TYPES, NOTIFICATION_PUBLIC_SELECT, serializeNotification } from '../../../lib/notifications';
import { flattenQuery, positiveInt } from '../../../lib/query-params';

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 50;

// Validates the notification list query string. Everything is optional, so an
// empty query returns the first page of the customer's notifications.
function parseNotificationQuery(raw) {
  const flat = flattenQuery(raw);

  if (flat.type !== undefined && !NOTIFICATION_TYPES.includes(flat.type)) {
    return { ok: false, error: 'That notification type is not one TopMint records.' };
  }
  if (flat.unread !== undefined && !['true', 'false', '1', '0'].includes(flat.unread)) {
    return { ok: false, error: 'The unread filter must be true or false.' };
  }

  const page = positiveInt(flat.page, { fallback: 1, max: 100000 });
  if (page === null) return { ok: false, error: 'The page number must be a whole number of 1 or more.' };

  const pageSize = positiveInt(flat.pageSize ?? flat.limit, { fallback: DEFAULT_PAGE_SIZE, max: MAX_PAGE_SIZE });
  if (pageSize === null) return { ok: false, error: `Page size must be a whole number between 1 and ${MAX_PAGE_SIZE}.` };

  const where = {};
  if (flat.type) where.type = flat.type;
  if (flat.unread === 'true' || flat.unread === '1') where.read = false;
  if (flat.unread === 'false' || flat.unread === '0') where.read = true;

  return {
    ok: true,
    value: {
      type: flat.type ?? null,
      unreadOnly: where.read === false,
      page,
      pageSize,
      skip: (page - 1) * pageSize,
      take: pageSize,
      where,
    },
  };
}

// GET   /api/notifications       — paged, filtered list plus the true unread count
// PATCH /api/notifications       — mark one notification read ({ id })
//
// Every query and update is scoped by the authenticated `userId`, so one
// customer can never read or modify another customer's notifications.
export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'PATCH') {
      const id = typeof req.body?.id === 'string' ? req.body.id : '';
      if (!id || id.length > 64) return res.status(400).json({ error: 'A notification id is required.' });

      const updated = await prisma.notification.updateMany({
        where: { id, userId: user.id },
        data: { read: true, readAt: new Date() },
      });
      // updateMany matches an already-read row too, so a count of zero means the
      // notification does not exist or belongs to another customer. Both answer
      // the same way on purpose, so the route never confirms another account's
      // notification ids.
      if (updated.count === 0) return res.status(404).json({ error: 'That notification could not be found.' });

      const unread = await prisma.notification.count({ where: { userId: user.id, read: false } });
      return res.status(200).json({ updated: updated.count, unread });
    }

    const query = parseNotificationQuery(req.query);
    if (!query.ok) return res.status(400).json({ error: query.error, code: 'VALIDATION_ERROR' });

    const { where, page, pageSize, skip, take } = query.value;
    const scope = { userId: user.id, ...where };

    const [total, unread, rows] = await prisma.$transaction([
      prisma.notification.count({ where: scope }),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
      prisma.notification.findMany({
        where: scope,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: NOTIFICATION_PUBLIC_SELECT,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return res.status(200).json({
      notifications: rows.map(serializeNotification),
      // Counted in the database, not derived from the page the browser holds.
      unread,
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'NOTIFICATIONS_UNAVAILABLE',
      message: 'Unable to load your notifications right now. Please try again shortly.',
    });
  }
}
