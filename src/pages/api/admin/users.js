import { requireAdmin } from '../../../lib/admin-auth';
import { prisma } from '../../../lib/db/prisma';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res, ['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);
  if (!admin) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, email: true, firstName: true, lastName: true, phone: true,
      status: true, createdAt: true, lastLoginAt: true,
      wallet: { select: { balance: true, currency: true } },
      _count: { select: { investments: true, transactions: true } }
    }
  });

  return res.status(200).json({
    users: users.map(user => ({
      ...user,
      wallet: user.wallet ? { ...user.wallet, balance: user.wallet.balance.toString() } : null
    }))
  });
}
