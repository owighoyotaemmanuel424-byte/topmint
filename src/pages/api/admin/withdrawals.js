import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../../../lib/admin-auth';
import { prisma } from '../../../lib/db/prisma';
import { withTransaction, formatUsd } from '../../../lib/ledger';
import { notify } from '../../../lib/notifications';
import { respondWithError } from '../../../lib/db-error';

const REVIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN'];
const READ_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'];
const STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];

const bodySchema = z
  .object({
    id: z.string().min(1).max(64),
    action: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(300).optional(),
  })
  .refine(value => value.action !== 'reject' || (value.reason || '').length >= 3, {
    message: 'Give a short reason when rejecting a withdrawal.',
    path: ['reason'],
  });

const serialize = row => ({
  id: row.id,
  transactionId: row.transactionId,
  reference: row.transaction?.reference ?? null,
  amount: row.amount.toString(),
  fee: row.fee.toString(),
  currency: row.transaction?.currency ?? 'USD',
  status: row.status,
  bankName: row.bankName,
  accountName: row.accountName,
  accountNumber: row.accountNumber,
  processedAt: row.processedAt,
  createdAt: row.createdAt,
  customer: row.user
    ? { id: row.user.id, email: row.user.email, name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' ') || null }
    : null,
});

// GET  /api/admin/withdrawals   — the withdrawal review queue
// POST /api/admin/withdrawals   — approve a payout, or reject and refund it
//
// A withdrawal request already debits the wallet when it is submitted (the funds
// are reserved). Rejecting it therefore has to return those funds, which is done
// here as a compensating ledger entry against the same transaction. That keeps
// the ledger balanced and records the reversal as its own auditable event
// instead of editing the original debit.
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = await requireAdmin(req, res, READ_ROLES);
    if (!admin) return;

    if (req.method === 'GET') {
      const status = STATUSES.includes(req.query.status) ? req.query.status : 'PENDING';
      const rows = await prisma.withdrawal.findMany({
        where: { status },
        orderBy: { createdAt: 'asc' },
        take: 100,
        include: {
          transaction: { select: { reference: true, currency: true, status: true } },
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });
      return res.status(200).json({ withdrawals: rows.map(serialize), status });
    }

    if (!REVIEWER_ROLES.includes(admin.role)) {
      return res.status(403).json({ error: 'Your role cannot resolve withdrawal requests.' });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid withdrawal review request.' });
    }
    const { id, action, reason } = parsed.data;

    const result = await withTransaction(async tx => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id } });
      if (!withdrawal) return { outcome: 'NOT_FOUND' };
      // A resolved withdrawal is never re-applied, so a repeated rejection can
      // never refund the same funds twice.
      if (withdrawal.status !== 'PENDING') return { outcome: 'ALREADY_RESOLVED', status: withdrawal.status };

      const amount = new Prisma.Decimal(withdrawal.amount);

      if (action === 'approve') {
        const updated = await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: { status: 'COMPLETED', processedAt: new Date() },
        });
        await tx.transaction.update({ where: { id: withdrawal.transactionId }, data: { status: 'COMPLETED' } });
        await tx.auditLog.create({
          data: {
            adminId: admin.id,
            action: 'withdrawal.approved',
            entity: 'Transaction',
            entityId: withdrawal.transactionId,
            metadata: { withdrawalId: withdrawal.id, amount: amount.toString() },
          },
        });
        return { outcome: 'APPROVED', withdrawal: updated, userId: withdrawal.userId, amount };
      }

      const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
      if (!wallet) throw new Error('Wallet not found');

      // Return the reserved funds. This is the reversal of the debit recorded
      // when the request was submitted.
      const balance = new Prisma.Decimal(wallet.balance).add(amount);
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          transactionId: withdrawal.transactionId,
          amount,
          balanceAfter: balance,
          description: 'Withdrawal rejected — funds returned',
        },
      });
      const updated = await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'FAILED', processedAt: new Date() } });
      await tx.transaction.update({ where: { id: withdrawal.transactionId }, data: { status: 'CANCELLED' } });
      await tx.auditLog.create({
        data: {
          adminId: admin.id,
          action: 'withdrawal.rejected',
          entity: 'Transaction',
          entityId: withdrawal.transactionId,
          metadata: {
            withdrawalId: withdrawal.id,
            amount: amount.toString(),
            refunded: true,
            balanceAfter: balance.toString(),
            reason: reason || null,
          },
        },
      });
      return { outcome: 'REJECTED', withdrawal: updated, userId: withdrawal.userId, amount };
    });

    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'That withdrawal could not be found.' });
    if (result.outcome === 'ALREADY_RESOLVED') {
      return res.status(409).json({
        error: `That withdrawal is already ${result.status.toLowerCase()} and was not changed.`,
        code: 'ALREADY_RESOLVED',
      });
    }

    const approved = result.outcome === 'APPROVED';
    await notify(prisma, {
      userId: result.userId,
      type: 'WITHDRAWAL',
      title: approved ? 'Withdrawal approved' : 'Withdrawal rejected',
      message: approved
        ? `Your withdrawal of ${formatUsd(result.amount)} has been approved and is on its way.`
        : `Your withdrawal of ${formatUsd(result.amount)} was rejected and the funds have been returned to your wallet.${reason ? ` Reason: ${reason}` : ''}`,
      resourceType: 'Transaction',
      resourceId: result.withdrawal.transactionId,
      link: '/transactions',
      eventKey: `withdrawal:${approved ? 'approved' : 'rejected'}:${result.withdrawal.id}`,
    });

    return res.status(200).json({ withdrawal: serialize(result.withdrawal), action: result.outcome, delivery: 'in-app' });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'WITHDRAWAL_REVIEW_FAILED',
      message: 'Unable to review that withdrawal right now. Please try again shortly.',
    });
  }
}
