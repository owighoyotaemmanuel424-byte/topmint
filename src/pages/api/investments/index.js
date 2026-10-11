import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getAuthenticatedUser } from '../../../lib/api-auth';
import { withTransaction, debitWallet, publicErrorMessage, formatUsd } from '../../../lib/ledger';
import { notify } from '../../../lib/notifications';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';

const bodySchema = z.object({
  planId: z.string().min(1).max(128),
  amount: z.string().or(z.number()).transform(String).refine(value => /^\\d{1,10}(\\.\\d{1,2})?$/.test(value), 'Enter a valid amount with up to two decimal places.'),
  idempotencyKey: z.string().uuid(),
});

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    try {
      // Investment has no createdAt column; startedAt is its creation timestamp.
      const rows = await prisma.investment.findMany({ where: { userId: user.id }, include: { plan: true }, orderBy: { startedAt: 'desc' } });
      return res.status(200).json({ investments: rows.map(i => ({
        ...i,
        principal: i.principal.toString(),
        expectedReturn: i.expectedReturn.toString(),
        actualReturn: i.actualReturn?.toString() ?? '0',
        accruedEarnings: i.accruedEarnings.toString(), paidEarnings: i.paidEarnings.toString(), reference: i.reference, termsSnapshot: i.termsSnapshot,
        plan: { ...i.plan, minimumAmount: i.plan.minimumAmount.toString(), maximumAmount: i.plan.maximumAmount?.toString() ?? null, returnRate: i.plan.returnRate.toString() }
      })) });
    } catch (error) {
      return respondWithError(res, error, {
        fallback: 'INVESTMENTS_UNAVAILABLE',
        message: 'Unable to load your investments right now. Please try again shortly.',
      });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid investment request' });

  try {
    const result = await withTransaction(async tx => {
      const existing = await tx.investment.findUnique({ where: { requestKey: parsed.data.idempotencyKey }, include: { plan: true } });
      if (existing) { if (existing.userId !== user.id) throw new Error('Investment request key already used'); return { investment: existing, created: false }; }
      const plan = await tx.investmentPlan.findUnique({ where: { id: parsed.data.planId } });
      if (!plan || !plan.active) throw new Error('Investment plan unavailable');
      const amount = new Prisma.Decimal(parsed.data.amount);
      if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) throw new Error('Invalid amount');
      if (amount.lessThan(plan.minimumAmount) || (plan.maximumAmount !== null && amount.greaterThan(plan.maximumAmount))) throw new Error('Amount is outside this plan range');

      const reference = 'INV-' + crypto.randomBytes(10).toString('hex').toUpperCase();
      const transaction = await debitWallet(tx, {
        userId: user.id,
        amount,
        type: 'INVESTMENT',
        description: 'Investment in ' + plan.name,
        reference
      });

      const expectedReturn = plan.calculationMethod === 'SIMPLE_FIXED' ? amount.mul(plan.returnRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : new Prisma.Decimal(0);
      if (!['SIMPLE_FIXED', 'PRINCIPAL_ONLY'].includes(plan.calculationMethod)) throw new Error('Investment plan unavailable');
      const startedAt = new Date();
      const maturityAt = new Date(startedAt.getTime() + plan.durationDays * 86400000);
      const reference = 'INV-' + crypto.randomBytes(12).toString('hex').toUpperCase();
      const termsSnapshot = { planId: plan.id, planName: plan.name, description: plan.description, minimumAmount: plan.minimumAmount.toString(), maximumAmount: plan.maximumAmount?.toString() ?? null, durationDays: plan.durationDays, returnRate: plan.returnRate.toString(), calculationMethod: plan.calculationMethod, payoutSchedule: plan.payoutSchedule, maturityConditions: plan.maturityConditions, riskDisclosure: plan.riskDisclosure, feeRate: plan.feeRate.toString(), termsVersion: plan.termsVersion, currency: 'USD', capturedAt: startedAt.toISOString() };
      const investment = await tx.investment.create({
        data: { userId: user.id, planId: plan.id, principal: amount, expectedReturn, actualReturn: new Prisma.Decimal(0), accruedEarnings: new Prisma.Decimal(0), paidEarnings: new Prisma.Decimal(0), status: 'ACTIVE', startedAt, maturityAt, reference, requestKey: parsed.data.idempotencyKey, termsSnapshot }
      });
      await tx.transaction.update({ where: { id: transaction.id }, data: { investmentId: investment.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'investment.created', entity: 'Investment', entityId: investment.id, metadata: { reference, principal: amount.toString(), planId: plan.id, termsVersion: plan.termsVersion } } });
      return { investment, created: true };
    });

    // Confirmation is only sent after the investment and its wallet debit have
    // both committed.
    if (result.created) await notify(prisma, {
      userId: user.id,
      type: 'INVESTMENT',
      title: 'Investment created',
      message: `Your investment of ${formatUsd(result.investment.principal)} is active and matures on ${new Date(result.investment.maturityAt).toISOString().slice(0, 10)}. Projected earnings are not guaranteed.`,
      resourceType: 'Investment',
      resourceId: result.investment.id,
      link: '/investments',
      eventKey: `investment:created:${result.investment.id}`,
    });

    const investment = result.investment;
    return res.status(result.created ? 201 : 200).json({ investment: { ...investment, principal: investment.principal.toString(), expectedReturn: investment.expectedReturn.toString(), actualReturn: investment.actualReturn.toString(), accruedEarnings: investment.accruedEarnings.toString(), paidEarnings: investment.paidEarnings.toString() }, replayed: !result.created });
  } catch (error) {
    const message = publicErrorMessage(error, null);
    if (message) return res.status(400).json({ error: message });
    return respondWithError(res, error, {
      fallback: 'INVESTMENT_FAILED',
      message: 'Unable to start that investment right now. Please try again shortly.',
    });
  }
}
