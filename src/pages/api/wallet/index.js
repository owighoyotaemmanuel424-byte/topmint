import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id }, select: { id: true, balance: true, currency: true, updatedAt: true } });
    return res.status(200).json({ wallet: wallet ? { ...wallet, balance: wallet.balance.toString() } : null });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'WALLET_UNAVAILABLE',
      message: 'Unable to load your wallet right now. Please try again shortly.',
    });
  }
}
