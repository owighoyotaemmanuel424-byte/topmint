import { z } from 'zod';
import { getAuthenticatedUser } from '../../../lib/api-auth';
import { withTransaction } from '../../../lib/ledger';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';
import { notify } from '../../../lib/notifications';

const idSchema = z.string().min(1).max(128);

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const parsedId = idSchema.safeParse(req.query.id);
  if (!parsedId.success) return res.status(400).json({ error: 'Invalid deposit ID' });

  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await withTransaction(async tx => {
      const deposit = await tx.deposit.findFirst({
        where: { id: parsedId.data, userId: user.id },
        include: { transaction: true },
      });
      if (!deposit) {
        const error = new Error('Deposit request not found');
        error.code = 'DEPOSIT_NOT_FOUND';
        throw error;
      }
      if (deposit.status !== 'PENDING' || deposit.transaction.status !== 'PENDING') {
        const error = new Error('Only pending deposits can be cancelled');
        error.code = 'DEPOSIT_NOT_CANCELLABLE';
        throw error;
      }

      const changed = await tx.deposit.updateMany({
        where: { id: deposit.id, userId: user.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      if (changed.count !== 1) {
        const error = new Error('Deposit request has already changed');
        error.code = 'DEPOSIT_NOT_CANCELLABLE';
        throw error;
      }
      await tx.transaction.updateMany({
        where: { id: deposit.transactionId, userId: user.id, status: 'PENDING' },
        data: { status: 'CANCELLED', metadata: { cancellation: { cancelledAt: new Date().toISOString(), actor: 'CUSTOMER' } } },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'DEPOSIT_CANCELLED_BY_CUSTOMER',
          entity: 'Deposit',
          entityId: deposit.id,
          metadata: { reference: deposit.transaction.reference, amount: deposit.amount.toString(), currency: deposit.transaction.currency },
          ipAddress: typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0].trim() : null,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        },
      });
      return { id: deposit.id, transactionId: deposit.transactionId, reference: deposit.transaction.reference, amount: deposit.amount.toString(), currency: deposit.transaction.currency };
    });

    await notify(prisma, {
      userId: user.id,
      type: 'DEPOSIT',
      title: 'Deposit request cancelled',
      message: `Your pending deposit ${result.reference} was cancelled. No funds were credited.`,
      resourceType: 'Deposit',
      resourceId: result.id,
      link: '/deposit',
      eventKey: `deposit:cancelled:${result.id}`,
    });
    return res.status(200).json({ deposit: { id: result.id, reference: result.reference, status: 'CANCELLED' } });
  } catch (error) {
    if (error?.code === 'DEPOSIT_NOT_FOUND') return res.status(404).json({ error: 'Deposit request not found' });
    if (error?.code === 'DEPOSIT_NOT_CANCELLABLE') return res.status(409).json({ error: error.message });
    return respondWithError(res, error, {
      fallback: 'DEPOSIT_CANCEL_FAILED',
      message: 'Unable to cancel this deposit request right now.',
    });
  }
}
