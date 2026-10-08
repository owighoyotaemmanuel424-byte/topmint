import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getAuthenticatedUser } from '../../../lib/api-auth';
import { withTransaction } from '../../../lib/ledger';
import { prisma } from '../../../lib/db/prisma';

const schema = z.object({ amount: z.coerce.number().positive().max(100000000) });

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method === 'GET') {
    const rows = await prisma.deposit.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return res.status(200).json({ deposits: rows.map(d => ({ ...d, amount: d.amount.toString() })) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid deposit amount' });

  const amount = new Prisma.Decimal(parsed.data.amount.toFixed(2));
  const reference = 'DEP-' + crypto.randomBytes(10).toString('hex').toUpperCase();
  const result = await withTransaction(async tx => {
    const transaction = await tx.transaction.create({
      data: { userId: user.id, reference, type: 'DEPOSIT', status: 'PENDING', amount, description: 'Wallet deposit' }
    });
    return tx.deposit.create({ data: { userId: user.id, transactionId: transaction.id, provider: 'MANUAL', amount, status: 'PENDING' } });
  });
  return res.status(201).json({ deposit: { ...result, amount: result.amount.toString() }, reference });
}
