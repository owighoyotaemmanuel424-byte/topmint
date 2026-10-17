import { z } from 'zod';
import { prisma } from '../../lib/db/prisma';
import { getAuthenticatedUser } from '../../lib/api-auth';
import { respondWithError } from '../../lib/db-error';

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(30).regex(/^[+()0-9 .-]*$/).optional().or(z.literal('')),
}).strict();

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method === 'GET') {
    try {
      const record = await prisma.user.findUnique({ where: { id: user.id }, select: {
        id: true, email: true, firstName: true, lastName: true, phone: true,
        status: true, createdAt: true, updatedAt: true, emailVerifiedAt: true,
        passwordChangedAt: true, wallet: { select: { currency: true } },
      }});
      if (!record) return res.status(404).json({ error: 'Profile not found' });
      return res.status(200).json({ profile: { ...record, name: [record.firstName, record.lastName].filter(Boolean).join(' ') } });
    } catch (error) {
      return respondWithError(res, error, { fallback: 'PROFILE_LOAD_FAILED', message: 'Unable to load your profile.' });
    }
  }
  if (req.method === 'PATCH') {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter valid profile details.', code: 'VALIDATION_ERROR' });
    if (!Object.keys(parsed.data).length) return res.status(400).json({ error: 'No supported profile fields supplied.' });
    try {
      const data = { ...parsed.data };
      if (data.phone === '') data.phone = null;
      const updated = await prisma.$transaction(async tx => {
        const result = await tx.user.update({ where: { id: user.id }, data, select: {
          id: true, email: true, firstName: true, lastName: true, phone: true, status: true, createdAt: true, updatedAt: true, emailVerifiedAt: true,
        }});
        await tx.auditLog.create({ data: {
          userId: user.id, action: 'profile.updated', entity: 'User', entityId: user.id,
          metadata: { changedFields: Object.keys(data) },
          ipAddress: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64) || null,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : null,
        }});
        return result;
      });
      return res.status(200).json({ profile: { ...updated, name: [updated.firstName, updated.lastName].filter(Boolean).join(' ') } });
    } catch (error) {
      return respondWithError(res, error, { fallback: 'PROFILE_UPDATE_FAILED', message: 'Unable to update your profile.' });
    }
  }
  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
}
