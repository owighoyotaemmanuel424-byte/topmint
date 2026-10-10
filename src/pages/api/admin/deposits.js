import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../../../lib/admin-auth';
import { withTransaction } from '../../../lib/ledger';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';
import { notify } from '../../../lib/notifications';

const decisionSchema = z.object({
  depositId: z.string().min(1),
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().min(5).max(500),
  verifiedReceipt: z.boolean().optional(),
  providerRef: z.string().trim().max(160).optional(),
});

function serializeDeposit(deposit) {
  return {
    ...deposit,
    amount: deposit.amount.toString(),
    transaction: deposit.transaction
      ? { ...deposit.transaction, amount: deposit.transaction.amount.toString() }
      : undefined,
  };
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res, ['SUPER_ADMIN', 'ADMIN']);
  if (!admin) return;

  if (req.method === 'GET') {
    const rawStatus = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';
    const allowed = ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PROCESSING', 'ALL'];
    if (!allowed.includes(rawStatus)) return res.status(400).json({ error: 'Invalid deposit status filter' });

    try {
      const deposits = await prisma.deposit.findMany({
        where: rawStatus === 'ALL' ? {} : { status: rawStatus },
        orderBy: { createdAt: 'asc' },
        take: 100,
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          transaction: { select: { id: true, reference: true, status: true, amount: true, currency: true, createdAt: true } },
        },
      });
      return res.status(200).json({ deposits: deposits.map(serializeDeposit) });
    } catch (error) {
      return respondWithError(res, error, {
        fallback: 'ADMIN_DEPOSITS_UNAVAILABLE',
        message: 'Unable to load deposit requests right now.',
      });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Provide a deposit, a valid decision, and a review note of at least 5 characters.' });
  const { depositId, action, note, verifiedReceipt, providerRef } = parsed.data;
  if (action === 'approve' && verifiedReceipt !== true) {
    return res.status(400).json({ error: 'Confirm that payment was independently verified before approving this deposit.' });
  }
  if (action === 'reject' && !note.trim()) {
    return res.status(400).json({ error: 'A reason is required to reject a deposit.' });
  }

  try {
    const result = await withTransaction(async tx => {
      const deposit = await tx.deposit.findUnique({
        where: { id: depositId },
        include: { transaction: true },
      });
      if (!deposit) {
        const error = new Error('Deposit request not found');
        error.code = 'DEPOSIT_NOT_FOUND';
        throw error;
      }
      if (deposit.status !== 'PENDING' || deposit.transaction.status !== 'PENDING') {
        const error = new Error('Deposit request has already been reviewed');
        error.code = 'DEPOSIT_ALREADY_REVIEWED';
        throw error;
      }
      if (deposit.provider !== 'MANUAL') {
        const error = new Error('This deposit must be handled by its configured payment provider.');
        error.code = 'DEPOSIT_PROVIDER_MISMATCH';
        throw error;
      }

      // Claim the pending request inside the same serializable transaction. This
      // conditional transition prevents a second review from crediting the wallet.
      const claimed = await tx.deposit.updateMany({
        where: { id: deposit.id, status: 'PENDING' },
        data: {
          status: action === 'approve' ? 'COMPLETED' : 'FAILED',
          providerRef: providerRef || deposit.providerRef,
          metadata: {
            ...(deposit.metadata && typeof deposit.metadata === 'object' && !Array.isArray(deposit.metadata) ? deposit.metadata : {}),
            review: {
              action,
              note: note.trim(),
              adminId: admin.id,
              reviewedAt: new Date().toISOString(),
              verifiedReceipt: action === 'approve',
            },
          },
        },
      });
      if (claimed.count !== 1) {
        const error = new Error('Deposit request has already been reviewed');
        error.code = 'DEPOSIT_ALREADY_REVIEWED';
        throw error;
      }

      if (action === 'approve') {
        const wallet = await tx.wallet.findUnique({ where: { userId: deposit.userId } });
        if (!wallet) throw new Error('Wallet not found');
        if (wallet.currency !== deposit.transaction.currency) {
          const error = new Error('Deposit currency does not match wallet currency');
          error.code = 'DEPOSIT_CURRENCY_MISMATCH';
          throw error;
        }

        const amount = new Prisma.Decimal(deposit.amount);
        const balance = new Prisma.Decimal(wallet.balance).add(amount);
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            transactionId: deposit.transactionId,
            amount,
            balanceAfter: balance,
            description: `Verified wallet deposit ${deposit.transaction.reference}`,
          },
        });
        await tx.transaction.update({
          where: { id: deposit.transactionId },
          data: {
            status: 'COMPLETED',
            metadata: {
              ...(deposit.transaction.metadata && typeof deposit.transaction.metadata === 'object' && !Array.isArray(deposit.transaction.metadata) ? deposit.transaction.metadata : {}),
              depositReview: { action, note: note.trim(), adminId: admin.id, reviewedAt: new Date().toISOString() },
            },
          },
        });
      } else {
        await tx.transaction.update({
          where: { id: deposit.transactionId },
          data: {
            status: 'FAILED',
            metadata: {
              ...(deposit.transaction.metadata && typeof deposit.transaction.metadata === 'object' && !Array.isArray(deposit.transaction.metadata) ? deposit.transaction.metadata : {}),
              depositReview: { action, note: note.trim(), adminId: admin.id, reviewedAt: new Date().toISOString() },
            },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          adminId: admin.id,
          userId: deposit.userId,
          action: action === 'approve' ? 'DEPOSIT_APPROVED' : 'DEPOSIT_REJECTED',
          entity: 'Deposit',
          entityId: deposit.id,
          metadata: {
            amount: deposit.amount.toString(),
            currency: deposit.transaction.currency,
            reference: deposit.transaction.reference,
            note: note.trim(),
            providerRef: providerRef || deposit.providerRef || null,
          },
          ipAddress: typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0].trim() : null,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        },
      });

      return { id: deposit.id, userId: deposit.userId, amount: deposit.amount.toString(), currency: deposit.transaction.currency, status: action === 'approve' ? 'COMPLETED' : 'FAILED', reference: deposit.transaction.reference };
    });

    await notify(prisma, {
      userId: result.userId,
      type: action === 'approve' ? 'DEPOSIT' : 'SECURITY',
      title: action === 'approve' ? 'Deposit verified' : 'Deposit rejected',
      message: action === 'approve' ? `Your deposit ${result.reference} for ${result.currency} ${result.amount} was verified and credited.` : `Your deposit ${result.reference} was rejected after review. Please check the deposit details or contact support.`,
      resourceType: 'Deposit',
      resourceId: result.id,
      link: '/transactions',
      eventKey: `deposit:review:${result.id}:${result.status}`,
    });
    return res.status(200).json({ deposit: result, message: action === 'approve' ? 'Verified deposit approved and wallet credited.' : 'Deposit rejected; no wallet credit was made.' });
  } catch (error) {
    if (error?.code === 'DEPOSIT_NOT_FOUND') return res.status(404).json({ error: error.message });
    if (error?.code === 'DEPOSIT_ALREADY_REVIEWED' || error?.code === 'DEPOSIT_PROVIDER_MISMATCH' || error?.code === 'DEPOSIT_CURRENCY_MISMATCH') return res.status(409).json({ error: error.message });
    if (error?.message === 'Wallet not found') return res.status(409).json({ error: 'The customer wallet is missing; the deposit was not approved.' });
    return respondWithError(res, error, {
      fallback: 'DEPOSIT_REVIEW_FAILED',
      message: 'Unable to review this deposit right now. No partial wallet update was committed.',
    });
  }
}
