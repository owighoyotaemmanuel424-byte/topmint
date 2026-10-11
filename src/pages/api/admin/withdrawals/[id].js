import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../../../../lib/admin-auth';
import { withTransaction } from '../../../../lib/ledger';
import { prisma } from '../../../../lib/db/prisma';
import { notify } from '../../../../lib/notifications';
import { respondWithError } from '../../../../lib/db-error';

const decisionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().min(5).max(500),
});

function serialize(row) {
  return {
    ...row,
    amount: row.amount.toString(),
    fee: row.fee.toString(),
    transaction: row.transaction ? {
      ...row.transaction,
      amount: row.transaction.amount.toString(),
    } : null,
  };
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res, ['SUPER_ADMIN', 'ADMIN']);
  if (!admin) return;

  if (req.method === 'GET') {
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
      return res.status(200).json({ withdrawals: rows.map(serialize) });
    } catch (error) {
      return respondWithError(res, error, {
        fallback: 'ADMIN_WITHDRAWALS_UNAVAILABLE',
        message: 'Unable to load withdrawal requests right now.',
      });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ error: 'A withdrawal ID is required.' });
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose approve or reject and provide a review note of at least 5 characters.' });

  const { action, note } = parsed.data;
  try {
    const result = await withTransaction(async tx => {
      const withdrawal = await tx.withdrawal.findUnique({
        where: { id },
        include: { transaction: true },
      });
      if (!withdrawal) {
        const error = new Error('Withdrawal request not found.');
        error.code = 'WITHDRAWAL_NOT_FOUND';
        throw error;
      }
      if (withdrawal.status !== 'PENDING' || withdrawal.transaction.status !== 'PROCESSING') {
        const error = new Error('This withdrawal has already been reviewed.');
        error.code = 'WITHDRAWAL_ALREADY_REVIEWED';
        throw error;
      }

      const claimed = await tx.withdrawal.updateMany({
        where: { id: withdrawal.id, status: 'PENDING' },
        data: { status: action === 'approve' ? 'COMPLETED' : 'FAILED', processedAt: new Date() },
      });
      if (claimed.count !== 1) {
        const error = new Error('This withdrawal has already been reviewed.');
        error.code = 'WITHDRAWAL_ALREADY_REVIEWED';
        throw error;
      }

      if (action === 'approve') {
        await tx.transaction.updateMany({
          where: { id: withdrawal.transactionId, status: 'PROCESSING' },
          data: {
            status: 'COMPLETED',
            metadata: {
              adminReview: { action, note, adminId: admin.id, reviewedAt: new Date().toISOString() },
            },
          },
        });
      } else {
        const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
        if (!wallet) throw new Error('Wallet not found');
        if (wallet.currency !== withdrawal.transaction.currency) {
          const error = new Error('Withdrawal currency does not match wallet currency.');
          error.code = 'WITHDRAWAL_CURRENCY_MISMATCH';
          throw error;
        }

        const amount = new Prisma.Decimal(withdrawal.amount).add(withdrawal.fee);
        const balance = new Prisma.Decimal(wallet.balance).add(amount);
        const refund = await tx.transaction.create({
          data: {
            userId: withdrawal.userId,
            reference: 'REF-' + crypto.randomBytes(12).toString('hex').toUpperCase(),
            type: 'REFUND',
            status: 'COMPLETED',
            amount,
            currency: withdrawal.transaction.currency,
            description: 'Refund for rejected withdrawal',
            metadata: { withdrawalId: withdrawal.id, originalReference: withdrawal.transaction.reference, note, adminId: admin.id },
          },
        });
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            transactionId: refund.id,
            amount,
            balanceAfter: balance,
            description: 'Refund of rejected withdrawal ' + withdrawal.transaction.reference,
          },
        });
        await tx.transaction.updateMany({
          where: { id: withdrawal.transactionId, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            metadata: {
              adminReview: { action, note, adminId: admin.id, reviewedAt: new Date().toISOString(), refundTransactionId: refund.id },
            },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          adminId: admin.id,
          userId: withdrawal.userId,
          action: action === 'approve' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED_REFUNDED',
          entity: 'Withdrawal',
          entityId: withdrawal.id,
          metadata: {
            amount: withdrawal.amount.toString(),
            fee: withdrawal.fee.toString(),
            currency: withdrawal.transaction.currency,
            reference: withdrawal.transaction.reference,
            note,
          },
          ipAddress: typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0].trim() : null,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        },
      });

      return {
        id: withdrawal.id,
        userId: withdrawal.userId,
        amount: withdrawal.amount.toString(),
        fee: withdrawal.fee.toString(),
        currency: withdrawal.transaction.currency,
        reference: withdrawal.transaction.reference,
        status: action === 'approve' ? 'COMPLETED' : 'FAILED',
      };
    });

    await notify(prisma, {
      userId: result.userId,
      type: 'WITHDRAWAL',
      title: action === 'approve' ? 'Withdrawal approved' : 'Withdrawal rejected and refunded',
      message: action === 'approve'
        ? `Your withdrawal ${result.reference} has been approved for payout. The transfer may take additional time to arrive.`
        : `Your withdrawal ${result.reference} was rejected. ${result.currency} ${(Number(result.amount) + Number(result.fee)).toFixed(2)} has been returned to your wallet.`,
      resourceType: 'Withdrawal',
      resourceId: result.id,
      link: '/transactions',
      eventKey: `withdrawal:review:${result.id}:${result.status}`,
    });
    return res.status(200).json({
      withdrawal: result,
      message: action === 'approve'
        ? 'Withdrawal approved. Complete the actual bank transfer separately and retain its reference.'
        : 'Withdrawal rejected and the reserved funds were returned to the wallet.',
    });
  } catch (error) {
    if (error?.code === 'WITHDRAWAL_NOT_FOUND') return res.status(404).json({ error: error.message });
    if (error?.code === 'WITHDRAWAL_ALREADY_REVIEWED' || error?.code === 'WITHDRAWAL_CURRENCY_MISMATCH') return res.status(409).json({ error: error.message });
    if (error?.message === 'Wallet not found') return res.status(409).json({ error: 'The customer wallet is missing; no review was committed.' });
    return respondWithError(res, error, {
      fallback: 'WITHDRAWAL_REVIEW_FAILED',
      message: 'Unable to review this withdrawal right now. No partial wallet update was committed.',
    });
  }
}
