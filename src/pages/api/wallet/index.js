import { Prisma } from '@prisma/client';
import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';

const decimalString = value => value instanceof Prisma.Decimal ? value.toString() : new Prisma.Decimal(value || 0).toString();

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [wallet, deposits, withdrawals, invested, recentActivity] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId: user.id }, select: { id: true, balance: true, currency: true, updatedAt: true } }),
      prisma.deposit.aggregate({ where: { userId: user.id, status: 'COMPLETED' }, _sum: { amount: true } }),
      prisma.withdrawal.aggregate({ where: { userId: user.id, status: 'COMPLETED' }, _sum: { amount: true } }),
      prisma.investment.aggregate({ where: { userId: user.id, status: { in: ['ACTIVE', 'COMPLETED'] } }, _sum: { principal: true } }),
      prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, reference: true, type: true, status: true, amount: true, currency: true, description: true, createdAt: true },
      }),
    ]);

    return res.status(200).json({
      wallet: wallet ? { ...wallet, balance: decimalString(wallet.balance) } : null,
      totals: {
        deposits: decimalString(deposits._sum.amount),
        withdrawals: decimalString(withdrawals._sum.amount),
        invested: decimalString(invested._sum.principal),
      },
      recentActivity: recentActivity.map(row => ({ ...row, amount: decimalString(row.amount) })),
    });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'WALLET_UNAVAILABLE',
      message: 'Unable to load your wallet right now. Please try again shortly.',
    });
  }
}
