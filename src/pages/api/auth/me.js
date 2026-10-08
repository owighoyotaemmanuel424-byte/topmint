import { prisma } from '../../../lib/db/prisma';
import { verifyAuthToken } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await verifyAuthToken(req.cookies?.token);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, phone: true, status: true, createdAt: true,
      wallet: { select: { balance: true, currency: true } },
    },
  });
  if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Unauthorized' });
  return res.status(200).json({ user });
}
