import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../../lib/db/prisma';
import { getAuthenticatedUser } from '../../../lib/api-auth';
import { notify } from '../../../lib/notifications';
import { respondWithError } from '../../../lib/db-error';

const schema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

// POST /api/auth/password — change the signed-in customer's password.
//
// The current password is required, so a stolen session cookie alone cannot
// lock the owner out. The change is recorded in the audit log and produces a
// security notification, which is the customer-visible alert for exactly this
// kind of event.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Enter your current password and a new password of at least 8 characters.',
        code: 'VALIDATION_ERROR',
      });
    }

    const { currentPassword, newPassword } = parsed.data;
    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) return res.status(400).json({ error: 'Your current password is incorrect.' });
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'Choose a new password that is different from your current one.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const ipAddress = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : null;

    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.auditLog.create({
        data: { userId: user.id, action: 'password.changed', entity: 'User', entityId: user.id, ipAddress, userAgent },
      });
    });

    // Sent after the new password is stored. No event key is needed: replaying
    // this request fails at the current-password check, because the password it
    // supplied is no longer the current one.
    await notify(prisma, {
      userId: user.id,
      type: 'SECURITY',
      title: 'Your password was changed',
      message: 'Your TopMint account password was changed. If you did not make this change, contact support immediately.',
      resourceType: 'User',
      resourceId: user.id,
      link: '/profile',
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'PASSWORD_CHANGE_FAILED',
      message: 'Unable to change your password right now. Please try again shortly.',
    });
  }
}
