import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getAuthenticatedUser } from '../../../lib/api-auth';
import { withTransaction, formatUsd } from '../../../lib/ledger';
import { notify } from '../../../lib/notifications';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';

const schema = z.object({ amount: z.coerce.number().positive().max(100000000).refine(value => Number(value.toFixed(2)) >= 0.01, 'Amount must be at least $0.01') });

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    try {
      const rows = await prisma.deposit.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
      return res.status(200).json({ deposits: rows.map(d => ({ ...d, amount: d.amount.toString() })) });
    } catch (error) {
      return respondWithError(res, error, {
        fallback: 'DEPOSITS_UNAVAILABLE',
        message: 'Unable to load your deposits right now. Please try again shortly.',
      });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid deposit amount' });

  try {
    const amount = new Prisma.Decimal(parsed.data.amount.toFixed(2));
    const reference = 'DEP-' + crypto.randomBytes(10).toString('hex').toUpperCase();
    const result = await withTransaction(async tx => {
      const transaction = await tx.transaction.create({
        data: { userId: user.id, reference, type: 'DEPOSIT', status: 'PENDING', amount, description: 'Wallet deposit' }
      });
      return tx.deposit.create({ data: { userId: user.id, transactionId: transaction.id, provider: 'MANUAL', amount, status: 'PENDING' } });
    });

    // Written after the financial transaction commits: a notification failure can
    // never undo the deposit record, and the event key makes a retried request
    // idempotent instead of producing a second notification.
    await notify(prisma, {
      userId: user.id,
      type: 'DEPOSIT',
      title: 'Deposit request received',
      message: `We received your deposit request for ${formatUsd(result.amount)}. Your wallet is credited once the payment is verified.`,
      resourceType: 'Transaction',
      resourceId: result.transactionId,
      link: '/transactions',
      eventKey: `deposit:created:${result.id}`,
    });

    return res.status(201).json({ deposit: { ...result, amount: result.amount.toString() }, reference });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'DEPOSIT_FAILED',
      message: 'Unable to create your deposit request right now. Please try again shortly.',
    });
  }
}
