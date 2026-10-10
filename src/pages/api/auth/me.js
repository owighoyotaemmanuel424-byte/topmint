import { prisma } from '../../../lib/db/prisma';
import { verifyAuthToken } from '../../../lib/auth';
import { respondWithError } from '../../../lib/db-error';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await verifyAuthToken(req.cookies?.token);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true, status: true, createdAt: true,
        wallet: { select: { balance: true, currency: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(200).json({ user: { ...user, name: [user.firstName, user.lastName].filter(Boolean).join(' ') } });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'ACCOUNT_UNAVAILABLE',
      message: 'Unable to load your account right now. Please try again shortly.',
    });
  }
}
