import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getAuthenticatedUser } from '../../../lib/api-auth';
import { withTransaction, publicErrorMessage, formatUsd } from '../../../lib/ledger';
import { notify } from '../../../lib/notifications';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';

const schema = z.object({
  amount: z.union([z.string(), z.number()]).transform(v => String(v).trim()).refine(v => /^\d{1,9}(?:\.\d{1,2})?$/.test(v), 'Enter a valid USD amount with no more than two decimal places.').transform(v => new Prisma.Decimal(v)).refine(v => v.greaterThanOrEqualTo('0.01') && v.lessThanOrEqualTo('100000000'), 'Withdrawal must be between $0.01 and $100,000,000.00.'),
  bankName: z.string().trim().min(2).max(100),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().regex(/^\d{8,20}$/),
});

const mask = value => value ? '••••' + String(value).slice(-4) : null;
const serialize = w => ({ id: w.id, amount: w.amount.toString(), fee: w.fee.toString(), bankName: w.bankName, accountName: w.accountName, accountNumber: mask(w.accountNumber), status: w.status, processedAt: w.processedAt, createdAt: w.createdAt, transaction: w.transaction ? { reference: w.transaction.reference, status: w.transaction.status, currency: w.transaction.currency, metadata: w.transaction.metadata } : null });

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method === 'GET') {
    try {
      const rows = await prisma.withdrawal.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50, include: { transaction: { select: { reference: true, status: true, currency: true, metadata: true } } } });
      return res.status(200).json({ withdrawals: rows.map(serialize) });
    } catch (error) { return respondWithError(res, error, { fallback: 'WITHDRAWALS_UNAVAILABLE', message: 'Unable to load your withdrawals right now. Please try again shortly.' }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid withdrawal details.' });
  try {
    const result = await withTransaction(async tx => {
      const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!wallet) throw new Error('Wallet not found');
      if (wallet.currency !== 'USD') throw new Error('Withdrawal currency does not match wallet currency');
      const amount = parsed.data.amount;
      const reference = 'WDR-' + crypto.randomBytes(10).toString('hex').toUpperCase();
      const transaction = await tx.transaction.create({ data: { userId: user.id, reference, type: 'WITHDRAWAL', status: 'PROCESSING', amount, currency: 'USD', description: 'Wallet withdrawal', metadata: { payoutWorkflow: 'MANUAL', createdAt: new Date().toISOString() } } });
      // Atomic conditional debit: concurrent requests cannot both spend the same balance.
      const debit = await tx.wallet.updateMany({ where: { id: wallet.id, currency: 'USD', balance: { gte: amount } }, data: { balance: { decrement: amount } } });
      if (debit.count !== 1) throw new Error('Insufficient wallet balance');
      const updatedWallet = await tx.wallet.findUnique({ where: { id: wallet.id }, select: { balance: true } });
      const withdrawal = await tx.withdrawal.create({ data: { userId: user.id, transactionId: transaction.id, amount, fee: new Prisma.Decimal('0.00'), bankName: parsed.data.bankName, accountName: parsed.data.accountName, accountNumber: parsed.data.accountNumber, status: 'PENDING' } });
      await tx.ledgerEntry.create({ data: { walletId: wallet.id, transactionId: transaction.id, amount: amount.negated(), balanceAfter: updatedWallet.balance, description: 'Withdrawal funds reserved pending manual payout' } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'WITHDRAWAL_REQUEST_CREATED', entity: 'Withdrawal', entityId: withdrawal.id, metadata: { amount: amount.toString(), currency: 'USD', reference, payoutMethod: 'BANK_TRANSFER', accountLast4: parsed.data.accountNumber.slice(-4) }, ipAddress: typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0].trim() : null, userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null } });
      return { withdrawal, reference };
    });
    try { await notify(prisma, { userId: user.id, type: 'WITHDRAWAL', title: 'Withdrawal request submitted', message: 'Your withdrawal request for ' + formatUsd(result.withdrawal.amount) + ' is pending review. It has not been paid out.', resourceType: 'Transaction', resourceId: result.withdrawal.transactionId, link: '/transactions', eventKey: 'withdrawal:created:' + result.withdrawal.id }); } catch (notificationError) { /* Financial request is committed; notification retries must not affect the ledger. */ }
    return res.status(201).json({ withdrawal: { ...result.withdrawal, amount: result.withdrawal.amount.toString(), fee: result.withdrawal.fee.toString(), accountNumber: mask(result.withdrawal.accountNumber) }, reference: result.reference, message: 'Withdrawal request submitted. Funds are reserved pending manual review; no payout has been sent.' });
  } catch (error) {
    const message = publicErrorMessage(error, null);
    if (message) return res.status(400).json({ error: message });
    if (error?.message === 'Withdrawal currency does not match wallet currency') return res.status(409).json({ error: error.message });
    return respondWithError(res, error, { fallback: 'WITHDRAWAL_FAILED', message: 'Unable to submit your withdrawal request right now. Please try again shortly.' });
  }
}
