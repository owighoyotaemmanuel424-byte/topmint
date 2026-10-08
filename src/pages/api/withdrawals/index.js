import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getAuthenticatedUser } from '../../../lib/api-auth';
import { withTransaction } from '../../../lib/ledger';
import { prisma } from '../../../lib/db/prisma';

const schema = z.object({
  amount: z.coerce.number().positive().max(100000000),
  bankName: z.string().min(2).max(100),
  accountName: z.string().min(2).max(120),
  accountNumber: z.string().regex(/^\d{8,20}$/)
});

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method === 'GET') {
    const rows = await prisma.withdrawal.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return res.status(200).json({ withdrawals: rows.map(w => ({ ...w, amount: w.amount.toString(), fee: w.fee.toString() })) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid withdrawal details' });

  try {
    const result = await withTransaction(async tx => {
      const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!wallet) throw new Error('Wallet not found');
      const amount = new Prisma.Decimal(parsed.data.amount.toFixed(2));
      if (new Prisma.Decimal(wallet.balance).lessThan(amount)) throw new Error('Insufficient wallet balance');
      const reference = 'WDR-' + crypto.randomBytes(10).toString('hex').toUpperCase();
      const balanceAfter = new Prisma.Decimal(wallet.balance).sub(amount);
      const transaction = await tx.transaction.create({
        data: { userId: user.id, reference, type: 'WITHDRAWAL', status: 'PROCESSING', amount, description: 'Wallet withdrawal' }
      });
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
      await tx.ledgerEntry.create({ data: { walletId: wallet.id, transactionId: transaction.id, amount: amount.neg(), balanceAfter, description: 'Wallet withdrawal reservation' } });
      const withdrawal = await tx.withdrawal.create({
        data: { userId: user.id, transactionId: transaction.id, amount, fee: new Prisma.Decimal(0), bankName: parsed.data.bankName, accountName: parsed.data.accountName, accountNumber: parsed.data.accountNumber, status: 'PENDING' }
      });
      return { withdrawal, reference };
    });
    return res.status(201).json({ withdrawal: { ...result.withdrawal, amount: result.withdrawal.amount.toString(), fee: result.withdrawal.fee.toString() }, reference: result.reference });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Withdrawal failed' });
  }
}
