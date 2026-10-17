import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const events = await prisma.auditLog.findMany({
      where: { userId: user.id, action: { in: ['password.changed', 'profile.updated', 'password.reset', 'email.verified', 'email.verification_requested', 'auth.login'] } },
      orderBy: { createdAt: 'desc' }, take: 25,
      select: { id: true, action: true, entity: true, createdAt: true, metadata: true },
    });
    return res.status(200).json({ events, lastLoginAt: user.lastLoginAt, passwordChangedAt: user.passwordChangedAt });
  } catch (error) {
    return respondWithError(res, error, { fallback: 'SECURITY_ACTIVITY_FAILED', message: 'Unable to load security activity.' });
  }
}
