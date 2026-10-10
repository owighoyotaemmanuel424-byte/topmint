// Server-side notification creation.
//
// Every notification is produced from a trusted server operation (sign-up, a
// deposit or withdrawal request, an investment, a password change, an admin
// announcement), never from a value supplied by the browser. Two rules keep the
// notification system from being able to damage the financial system:
//
//   1. Creating a notification never throws. A failure is logged and swallowed,
//      so it cannot roll back or leave half-applied a wallet, ledger or
//      transaction write.
//   2. Callers pass a deterministic `eventKey`. The (userId, eventKey) unique
//      constraint means a retried business operation is a no-op instead of a
//      duplicate notification.
//
// Notifications are therefore created *after* the financial transaction has
// committed. Losing a notification is acceptable; losing balance integrity is not.

export const NOTIFICATION_TYPES = [
  'ACCOUNT',
  'DEPOSIT',
  'WITHDRAWAL',
  'INVESTMENT',
  'INVESTMENT_MATURITY',
  'INVESTMENT_EARNING',
  'PAYMENT',
  'SECURITY',
  'ACCOUNT_UPDATE',
  'ANNOUNCEMENT',
];

const TITLE_MAX = 160;
const MESSAGE_MAX = 1000;

// The columns the customer notification centre may see. `eventKey` is
// intentionally excluded: it is an internal idempotency key.
export const NOTIFICATION_PUBLIC_SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  resourceType: true,
  resourceId: true,
  link: true,
  read: true,
  readAt: true,
  createdAt: true,
};

// Serialises a notification row for JSON: timestamps become ISO strings and
// readAt is always present so the client shape is stable.
export function serializeNotification(row) {
  if (!row) return null;
  return {
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    readAt: row.readAt instanceof Date ? row.readAt.toISOString() : row.readAt ?? null,
  };
}

function clean(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Create one notification. Returns the created row, or null when the input was
 * unusable, the event was already notified, or the write failed.
 *
 * @param {object} client     Prisma client or transaction client.
 * @param {object} input      { userId, type, title, message, resourceType?, resourceId?, link?, eventKey? }
 */
export async function notify(client, input) {
  const userId = typeof input?.userId === 'string' ? input.userId : null;
  const title = clean(input?.title, TITLE_MAX);
  const message = clean(input?.message, MESSAGE_MAX);
  if (!userId || !title || !message) return null;

  const type = NOTIFICATION_TYPES.includes(input?.type) ? input.type : 'ACCOUNT';
  const data = {
    userId,
    type,
    title,
    message,
    resourceType: clean(input?.resourceType, 40),
    resourceId: clean(input?.resourceId, 60),
    link: clean(input?.link, 200),
    eventKey: clean(input?.eventKey, 200),
  };

  try {
    return await client.notification.create({ data });
  } catch (error) {
    // P2002: this exact business event was already notified. That is the point of
    // the event key, so it is not an error worth surfacing.
    if (error?.code === 'P2002') return null;
    console.error('notification create failed', {
      userId,
      type,
      code: error?.code,
      name: error?.name,
      message: error?.message,
    });
    return null;
  }
}

/**
 * Bulk-create notifications for many customers (admin announcements).
 * `skipDuplicates` relies on the (userId, eventKey) unique constraint, so
 * re-publishing the same announcement creates nothing.
 *
 * @returns {Promise<{ created: number, skipped: number }>}
 */
export async function notifyMany(client, userIds, input) {
  const title = clean(input?.title, TITLE_MAX);
  const message = clean(input?.message, MESSAGE_MAX);
  const recipients = Array.isArray(userIds) ? userIds.filter(id => typeof id === 'string') : [];
  if (!title || !message || !recipients.length) return { created: 0, skipped: recipients.length };

  const type = NOTIFICATION_TYPES.includes(input?.type) ? input.type : 'ANNOUNCEMENT';
  const data = recipients.map(userId => ({
    userId,
    type,
    title,
    message,
    resourceType: clean(input?.resourceType, 40),
    link: clean(input?.link, 200),
    eventKey: clean(input?.eventKey, 200),
  }));

  try {
    const result = await client.notification.createMany({ data, skipDuplicates: true });
    return { created: result.count, skipped: recipients.length - result.count };
  } catch (error) {
    console.error('announcement create failed', { code: error?.code, message: error?.message });
    return { created: 0, skipped: recipients.length };
  }
}
