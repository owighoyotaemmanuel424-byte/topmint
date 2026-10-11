import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../../../../lib/admin-auth';
import { withTransaction } from '../../../../lib/ledger';
import { prisma } from '../../../../lib/db/prisma';
import { notify } from '../../../../lib/notifications';
import { respondWithError } from '../../../../lib/db-error';

const decisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'paid']),
  note: z.string().trim().min(5).max(500),
  payoutReference: z.string().trim().min(3).max(160).optional(),
}).superRefine((value, ctx) => {
  if (value.action === 'paid' && !value.payoutReference) ctx.addIssue({ code: 'custom', path: ['payoutReference'], message: 'A payout reference is required to confirm a manual payout.' });
});

function serialize(row) {
  return { ...row, amount: row.amount.toString(), fee: row.fee.toString(), accountNumber: row.accountNumber ? '••••' + row.accountNumber.slice(-4) : null, transaction: row.transaction ? { ...row.transaction, amount: row.transaction.amount.toString() } : null };
}
function conflict(message, code) { const error = new Error(message); error.code = code; return error; }

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res, ['SUPER_ADMIN', 'ADMIN']);
  if (!admin) return;
  if (req.method === 'GET') {
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';
    const allowed = ['PENDING', 'COMPLETED', 'FAILED', 'PROCESSING', 'CANCELLED', 'ALL'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid withdrawal status filter.' });
    try {
      const rows = await prisma.withdrawal.findMany({ where: status === 'ALL' ? {} : { status }, orderBy: { createdAt: 'asc' }, take: 100, include: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, transaction: { select: { id: true, reference: true, status: true, amount: true, currency: true, createdAt: true, metadata: true } } } });
      return res.status(200).json({ withdrawals: rows.map(serialize) });
    } catch (error) { return respondWithError(res, error, { fallback: 'ADMIN_WITHDRAWALS_UNAVAILABLE', message: 'Unable to load withdrawal requests right now.' }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ error: 'A withdrawal ID is required.' });
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid withdrawal review request.' });
  const { action, note, payoutReference } = parsed.data;
  try {
    const result = await withTransaction(async tx => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id }, include: { transaction: true } });
      if (!withdrawal) throw conflict('Withdrawal request not found.', 'WITHDRAWAL_NOT_FOUND');
      const transaction = withdrawal.transaction;
      if (transaction.status !== 'PROCESSING' || !['PENDING', 'PROCESSING'].includes(withdrawal.status)) throw conflict('This withdrawal is already resolved or is in an invalid state.', 'WITHDRAWAL_ALREADY_REVIEWED');
      const now = new Date();
      const oldMeta = transaction.metadata && typeof transaction.metadata === 'object' && !Array.isArray(transaction.metadata) ? transaction.metadata : {};
      const oldReview = oldMeta.adminReview && typeof oldMeta.adminReview === 'object' ? oldMeta.adminReview : {};
      let status, txStatus, refundTransactionId = null;
      if (action === 'approve') {
        if (withdrawal.status !== 'PENDING') throw conflict('Only pending withdrawals can be approved.', 'WITHDRAWAL_INVALID_TRANSITION');
        status = 'PROCESSING'; txStatus = 'PROCESSING';
      } else if (action === 'paid') {
        if (withdrawal.status !== 'PROCESSING' || !oldReview.approvedAt) throw conflict('Only an approved, processing withdrawal can be marked paid.', 'WITHDRAWAL_INVALID_TRANSITION');
        status = 'COMPLETED'; txStatus = 'COMPLETED';
      } else {
        if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'PROCESSING') throw conflict('This withdrawal cannot be rejected in its current state.', 'WITHDRAWAL_INVALID_TRANSITION');
        if (oldReview.paidAt || oldReview.payoutReference) throw conflict('A payout has already been recorded; do not refund this request.', 'WITHDRAWAL_ALREADY_PAID');
        const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
        if (!wallet) throw new Error('Wallet not found');
        if (wallet.currency !== transaction.currency) throw conflict('Withdrawal currency does not match wallet currency.', 'WITHDRAWAL_CURRENCY_MISMATCH');
        // The current system charges no configured withdrawal fee. Refund exactly
        // the amount reserved at request creation, avoiding an unearned fee refund.
        const refundAmount = new Prisma.Decimal(withdrawal.amount);
        const balance = new Prisma.Decimal(wallet.balance).add(refundAmount);
        const refund = await tx.transaction.create({ data: { userId: withdrawal.userId, reference: 'REF-' + crypto.randomBytes(12).toString('hex').toUpperCase(), type: 'REFUND', status: 'COMPLETED', amount: refundAmount, currency: transaction.currency, description: 'Refund for rejected withdrawal', metadata: { withdrawalId: withdrawal.id, originalReference: transaction.reference, note, adminId: admin.id } } });
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
        await tx.ledgerEntry.create({ data: { walletId: wallet.id, transactionId: refund.id, amount: refundAmount, balanceAfter: balance, description: 'Refund of rejected withdrawal ' + transaction.reference } });
        refundTransactionId = refund.id; status = 'FAILED'; txStatus = 'FAILED';
      }
      const review = { ...oldReview, lastAction: action, note, adminId: admin.id, updatedAt: now.toISOString() };
      if (action === 'approve') { review.approvedAt = now.toISOString(); review.approvedBy = admin.id; }
      if (action === 'paid') { review.paidAt = now.toISOString(); review.paidBy = admin.id; review.payoutReference = payoutReference; }
      if (action === 'reject') { review.rejectedAt = now.toISOString(); review.rejectedBy = admin.id; review.refundTransactionId = refundTransactionId; }
      const claimStatus = action === 'approve' ? 'PENDING' : withdrawal.status;
      const claimed = await tx.withdrawal.updateMany({ where: { id: withdrawal.id, status: claimStatus }, data: { status, processedAt: action === 'paid' || action === 'reject' ? now : null } });
      if (claimed.count !== 1) throw conflict('This withdrawal was changed by another request. Refresh and try again.', 'WITHDRAWAL_ALREADY_REVIEWED');
      const updatedTx = await tx.transaction.updateMany({ where: { id: transaction.id, status: 'PROCESSING' }, data: { status: txStatus, metadata: { ...oldMeta, adminReview: review } } });
      if (updatedTx.count !== 1) throw conflict('Transaction state changed; no withdrawal action was committed.', 'WITHDRAWAL_ALREADY_REVIEWED');
      await tx.auditLog.create({ data: { adminId: admin.id, userId: withdrawal.userId, action: action === 'approve' ? 'WITHDRAWAL_APPROVED_FOR_PAYOUT' : action === 'paid' ? 'WITHDRAWAL_MARKED_PAID' : 'WITHDRAWAL_REJECTED_REFUNDED', entity: 'Withdrawal', entityId: withdrawal.id, metadata: { amount: withdrawal.amount.toString(), fee: withdrawal.fee.toString(), currency: transaction.currency, reference: transaction.reference, note, payoutReference: action === 'paid' ? payoutReference : null, refundTransactionId }, ipAddress: typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0].trim() : null, userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null } });
      return { id: withdrawal.id, userId: withdrawal.userId, transactionId: transaction.id, amount: withdrawal.amount.toString(), currency: transaction.currency, reference: transaction.reference, status, action, payoutReference: action === 'paid' ? payoutReference : null, refundTransactionId };
    });
    const copy = result.action === 'approve' ? ['Withdrawal approved for payout', 'Your withdrawal ' + result.reference + ' has been approved for manual payout. It is not marked paid yet.'] : result.action === 'paid' ? ['Withdrawal payout recorded', 'Your withdrawal ' + result.reference + ' was marked paid with payout reference ' + result.payoutReference + '.'] : ['Withdrawal rejected and refunded', 'Your withdrawal ' + result.reference + ' was rejected and the reserved amount was returned to your wallet.'];
    await notify(prisma, { userId: result.userId, type: 'WITHDRAWAL', title: copy[0], message: copy[1], resourceType: 'Withdrawal', resourceId: result.id, link: '/transactions', eventKey: 'withdrawal:admin-action:' + result.id + ':' + result.action });
    return res.status(200).json({ withdrawal: result, message: result.action === 'approve' ? 'Approved for payout. Complete the manual transfer, then record its bank/provider reference to mark it paid.' : result.action === 'paid' ? 'Payout recorded as paid with the supplied reference. Ensure this reference corresponds to confirmed payment evidence.' : 'Withdrawal rejected and reserved funds refunded exactly once.' });
  } catch (error) {
    if (['WITHDRAWAL_NOT_FOUND','WITHDRAWAL_ALREADY_REVIEWED','WITHDRAWAL_INVALID_TRANSITION','WITHDRAWAL_CURRENCY_MISMATCH','WITHDRAWAL_ALREADY_PAID'].includes(error?.code)) return res.status(error.code === 'WITHDRAWAL_NOT_FOUND' ? 404 : 409).json({ error: error.message, code: error.code });
    if (error?.message === 'Wallet not found') return res.status(409).json({ error: 'The customer wallet is missing; no review was committed.' });
    return respondWithError(res, error, { fallback: 'WITHDRAWAL_REVIEW_FAILED', message: 'Unable to review this withdrawal right now. No partial wallet update was committed.' });
  }
}
