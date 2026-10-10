import crypto from 'crypto';
import { z } from 'zod';
import { requireAdmin } from '../../../lib/admin-auth';
import { prisma } from '../../../lib/db/prisma';
import { notifyMany } from '../../../lib/notifications';
import { respondWithError } from '../../../lib/db-error';

const READ_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'];
// Support can review announcements but not publish them, so a read-only role
// cannot message the whole customer base.
const PUBLISH_ROLES = ['SUPER_ADMIN', 'ADMIN'];

// No email or SMS provider is configured for this deployment, so in-app
// delivery is the only real channel. Reporting that honestly is preferred over
// claiming an external message was sent.
const DELIVERY_STATUS = { inApp: 'delivered', email: 'not_configured', sms: 'not_configured' };

const MAX_RECIPIENTS = 20000;

const schema = z.object({
  title: z.string().trim().min(3).max(160),
  message: z.string().trim().min(3).max(1000),
  audience: z.enum(['ALL', 'ACTIVE']),
  link: z.string().trim().max(200).optional(),
});

// A stable fingerprint of the announcement content. Used as the per-recipient
// event key, so publishing the same announcement twice inserts nothing the
// second time instead of re-notifying every customer.
function announcementKey({ title, message, audience, link }) {
  return `announcement:${crypto.createHash('sha1').update([title, message, audience, link || ''].join('\u0000')).digest('hex')}`;
}

// GET  /api/admin/notifications  — published announcements with recipient counts
// POST /api/admin/notifications  — publish an announcement to an audience
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = await requireAdmin(req, res, READ_ROLES);
    if (!admin) return;

    if (req.method === 'GET') {
      // Distinct announcements, newest first, with how many customers received
      // each one. Only aggregate data crosses this boundary — never another
      // customer's private notification rows.
      const [rows, counts, total, unread] = await Promise.all([
        prisma.notification.findMany({
          where: { type: 'ANNOUNCEMENT', eventKey: { not: null } },
          distinct: ['eventKey'],
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { eventKey: true, title: true, message: true, link: true, createdAt: true },
        }),
        prisma.notification.groupBy({
          by: ['eventKey'],
          where: { type: 'ANNOUNCEMENT', eventKey: { not: null } },
          _count: { _all: true },
        }),
        prisma.notification.count(),
        prisma.notification.count({ where: { read: false } }),
      ]);

      const recipientsByKey = new Map(counts.map(row => [row.eventKey, row._count._all]));

      return res.status(200).json({
        announcements: rows.map(row => ({
          eventKey: row.eventKey,
          title: row.title,
          message: row.message,
          link: row.link,
          createdAt: row.createdAt,
          recipients: recipientsByKey.get(row.eventKey) ?? 0,
        })),
        stats: { notifications: total, unread, announcements: rows.length },
        delivery: DELIVERY_STATUS,
        permissions: { canPublish: PUBLISH_ROLES.includes(admin.role), role: admin.role },
      });
    }

    if (!PUBLISH_ROLES.includes(admin.role)) {
      return res.status(403).json({ error: 'Your role cannot publish announcements.' });
    }

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Enter an announcement title and message.',
        code: 'VALIDATION_ERROR',
      });
    }

    const { title, message, audience, link } = parsed.data;
    const recipients = await prisma.user.findMany({
      where: audience === 'ACTIVE' ? { status: 'ACTIVE' } : {},
      select: { id: true },
      take: MAX_RECIPIENTS,
    });
    if (!recipients.length) return res.status(400).json({ error: 'There are no customers in that audience.' });

    const eventKey = announcementKey({ title, message, audience, link });
    const { created, skipped } = await notifyMany(prisma, recipients.map(row => row.id), {
      type: 'ANNOUNCEMENT',
      title,
      message,
      link: link || null,
      resourceType: 'Announcement',
      eventKey,
    });

    // Every administrative action is audited, including how many customers were
    // actually reached.
    await prisma.auditLog.create({
      data: {
        adminId: admin.id,
        action: 'announcement.published',
        entity: 'Announcement',
        entityId: eventKey,
        metadata: { audience, recipients: recipients.length, created, skipped, title },
      },
    });

    return res.status(201).json({
      eventKey,
      recipients: recipients.length,
      created,
      skipped,
      // Omitted: the message is delivered in-app only. Saying otherwise would be
      // a false claim about an external send that never happened.
      delivery: DELIVERY_STATUS,
    });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'ANNOUNCEMENT_FAILED',
      message: 'Unable to manage announcements right now. Please try again shortly.',
    });
  }
}
