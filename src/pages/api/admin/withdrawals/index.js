import { requireAdmin } from '../../../../lib/admin-auth';
import { prisma } from '../../../../lib/db/prisma';
import { respondWithError } from '../../../../lib/db-error';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res, ['SUPER_ADMIN', 'ADMIN']);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';
  const allowed = ['PENDING', 'COMPLETED', 'FAILED', 'PROCESSING', 'ALL'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid withdrawal status filter.' });

  try {
    const rows = await prisma.withdrawal.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        transaction: { select: { id: true, reference: true, status: true, amount: true, currency: true, createdAt: true } },
      },
    });
    return res.status(200).json({
      withdrawals: rows.map(row => ({
        ...row,
        amount: row.amount.toString(),
        fee: row.fee.toString(),
        transaction: row.transaction ? { ...row.transaction, amount: row.transaction.amount.toString() } : null,
      })),
    });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'ADMIN_WITHDRAWALS_UNAVAILABLE',
      message: 'Unable to load withdrawal requests right now.',
    });
  }
}
