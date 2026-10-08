import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getAuthenticatedUser } from '../../../lib/api-auth';
import { withTransaction, debitWallet } from '../../../lib/ledger';
import { prisma } from '../../../lib/db/prisma';

const bodySchema = z.object({ planId: z.string().min(1), amount: z.coerce.number().positive() });

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const rows = await prisma.investment.findMany({ where: { userId: user.id }, include: { plan: true }, orderBy: { createdAt: 'desc' } });
    return res.status(200).json({ investments: rows.map(i => ({
      ...i,
      principal: i.principal.toString(),
      expectedReturn: i.expectedReturn.toString(),
      actualReturn: i.actualReturn?.toString() ?? null,
      plan: { ...i.plan, minimumAmount: i.plan.minimumAmount.toString(), maximumAmount: i.plan.maximumAmount.toString(), returnRate: i.plan.returnRate.toString() }
    })) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid investment request' });

  try {
    const result = await withTransaction(async tx => {
      const plan = await tx.investmentPlan.findUnique({ where: { id: parsed.data.planId } });
      if (!plan || !plan.active) throw new Error('Investment plan unavailable');
      const amount = new Prisma.Decimal(parsed.data.amount.toFixed(2));
      if (amount.lessThan(plan.minimumAmount) || amount.greaterThan(plan.maximumAmount)) throw new Error('Amount is outside this plan range');

      const reference = 'INV-' + crypto.randomBytes(10).toString('hex').toUpperCase();
      const transaction = await debitWallet(tx, {
        userId: user.id,
        amount,
        type: 'INVESTMENT',
        description: 'Investment in ' + plan.name,
        reference
      });

      const expectedReturn = amount.mul(plan.returnRate).div(100);
      const startedAt = new Date();
      const maturityAt = new Date(startedAt.getTime() + plan.durationDays * 86400000);
      const investment = await tx.investment.create({
        data: { userId: user.id, planId: plan.id, principal: amount, expectedReturn, status: 'ACTIVE', startedAt, maturityAt }
      });
      await tx.transaction.update({ where: { id: transaction.id }, data: { investmentId: investment.id } });
      return investment;
    });

    return res.status(201).json({ investment: { ...result, principal: result.principal.toString(), expectedReturn: result.expectedReturn.toString() } });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Investment failed' });
  }
}
