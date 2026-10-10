import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../../../lib/admin-auth';
import { prisma } from '../../../lib/db/prisma';
import { withTransaction, formatUsd } from '../../../lib/ledger';
import { notify } from '../../../lib/notifications';
import { respondWithError } from '../../../lib/db-error';

// Only operational staff may move money. Support can read the queue but not
// resolve it, so a read-only role cannot credit a wallet.
const REVIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN'];
const READ_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'];
const STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];

const bodySchema = z
  .object({
    id: z.string().min(1).max(64),
    action: z.enum(['verify', 'reject']),
    reason: z.string().trim().max(300).optional(),
  })
  .refine(value => value.action !== 'reject' || (value.reason || '').length >= 3, {
    message: 'Give a short reason when rejecting a deposit.',
    path: ['reason'],
  });

const serialize = row => ({
  id: row.id,
  transactionId: row.transactionId,
  reference: row.transaction?.reference ?? null,
  amount: row.amount.toString(),
  currency: row.transaction?.currency ?? 'USD',
  status: row.status,
  provider: row.provider,
  providerRef: row.providerRef,
  createdAt: row.createdAt,
  customer: row.user
    ? { id: row.user.id, email: row.user.email, name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' ') || null }
    : null,
});

// GET  /api/admin/deposits   — the deposit review queue (defaults to pending)
// POST /api/admin/deposits   — verify (credit the wallet) or reject a deposit
//
// Verification is the only operation in the platform that credits a deposit, and
// it is guarded by the deposit's current status inside a serializable
// transaction. A repeated verification therefore cannot credit twice, which is
// also what protects against a duplicated provider webhook reusing this route.
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = await requireAdmin(req, res, READ_ROLES);
    if (!admin) return;

    if (req.method === 'GET') {
      const status = STATUSES.includes(req.query.status) ? req.query.status : 'PENDING';
      const rows = await prisma.deposit.findMany({
        where: { status },
        orderBy: { createdAt: 'asc' },
        take: 100,
        include: {
          transaction: { select: { reference: true, currency: true, status: true } },
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });
      return res.status(200).json({ deposits: rows.map(serialize), status });
    }

    if (!REVIEWER_ROLES.includes(admin.role)) {
      return res.status(403).json({ error: 'Your role cannot resolve deposit requests.' });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid deposit review request.' });
    }
    const { id, action, reason } = parsed.data;

    const result = await withTransaction(async tx => {
      const deposit = await tx.deposit.findUnique({ where: { id } });
      if (!deposit) return { outcome: 'NOT_FOUND' };
      // A resolved deposit is never re-applied. This is the duplicate-credit
      // guard for repeated admin actions and replayed webhooks alike.
      if (deposit.status !== 'PENDING') return { outcome: 'ALREADY_RESOLVED', status: deposit.status };

      if (action === 'verify') {
        const wallet = await tx.wallet.findUnique({ where: { userId: deposit.userId } });
        if (!wallet) throw new Error('Wallet not found');

        const amount = new Prisma.Decimal(deposit.amount);
        const balance = new Prisma.Decimal(wallet.balance).add(amount);

        await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            transactionId: deposit.transactionId,
            amount,
            balanceAfter: balance,
            description: 'Deposit verified',
          },
        });
        await tx.transaction.update({ where: { id: deposit.transactionId }, data: { status: 'COMPLETED' } });
        const updated = await tx.deposit.update({ where: { id: deposit.id }, data: { status: 'COMPLETED' } });
        await tx.auditLog.create({
          data: {
            adminId: admin.id,
            action: 'deposit.verified',
            entity: 'Transaction',
            entityId: deposit.transactionId,
            metadata: { depositId: deposit.id, amount: amount.toString(), balanceAfter: balance.toString() },
          },
        });
        return { outcome: 'VERIFIED', deposit: updated, userId: deposit.userId, amount };
      }

      await tx.transaction.update({ where: { id: deposit.transactionId }, data: { status: 'FAILED' } });
      const updated = await tx.deposit.update({ where: { id: deposit.id }, data: { status: 'FAILED' } });
      await tx.auditLog.create({
        data: {
          adminId: admin.id,
          action: 'deposit.rejected',
          entity: 'Transaction',
          entityId: deposit.transactionId,
          metadata: { depositId: deposit.id, amount: deposit.amount.toString(), reason: reason || null },
        },
      });
      return { outcome: 'REJECTED', deposit: updated, userId: deposit.userId, amount: new Prisma.Decimal(deposit.amount) };
    });

    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'That deposit could not be found.' });
    if (result.outcome === 'ALREADY_RESOLVED') {
      return res.status(409).json({
        error: `That deposit is already ${result.status.toLowerCase()} and was not changed.`,
        code: 'ALREADY_RESOLVED',
      });
    }

    // The customer is told what actually happened, after the money movement
    // committed. A notification failure cannot affect the wallet.
    await notify(prisma, {
      userId: result.userId,
      type: 'DEPOSIT',
      title: result.outcome === 'VERIFIED' ? 'Deposit verified' : 'Deposit could not be verified',
      message:
        result.outcome === 'VERIFIED'
          ? `Your deposit of ${formatUsd(result.amount)} has been verified and credited to your wallet.`
          : `Your deposit of ${formatUsd(result.amount)} was not credited.${reason ? ` Reason: ${reason}` : ''}`,
      resourceType: 'Transaction',
      resourceId: result.deposit.transactionId,
      link: '/transactions',
      eventKey: `deposit:${result.outcome === 'VERIFIED' ? 'verified' : 'rejected'}:${result.deposit.id}`,
    });

    return res.status(200).json({
      deposit: serialize({ ...result.deposit, transaction: null, user: null }),
      action: result.outcome,
      delivery: 'in-app',
    });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'DEPOSIT_REVIEW_FAILED',
      message: 'Unable to review that deposit right now. Please try again shortly.',
    });
  }
}
