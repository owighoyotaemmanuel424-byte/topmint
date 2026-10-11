import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../../../lib/admin-auth';
import { prisma } from '../../../lib/db/prisma';

const schema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(1000).optional().nullable(),
  minimumAmount: z.coerce.number().positive(),
  maximumAmount: z.coerce.number().positive().nullable().optional(),
  durationDays: z.coerce.number().int().positive(),
  returnRate: z.coerce.number().nonnegative(),
  calculationMethod: z.enum(['SIMPLE_FIXED', 'PRINCIPAL_ONLY']).optional(),
  payoutSchedule: z.enum(['AT_MATURITY']).optional(),
  maturityConditions: z.string().max(2000).nullable().optional(),
  riskDisclosure: z.string().max(2000).nullable().optional(),
  feeRate: z.coerce.number().min(0).max(100).optional(),
  active: z.boolean().optional()
});

const serialize = p => ({
  ...p,
  minimumAmount: p.minimumAmount.toString(),
  maximumAmount: p.maximumAmount?.toString() ?? null,
  returnRate: p.returnRate.toString(),
  feeRate: p.feeRate.toString()
});

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res, ['SUPER_ADMIN', 'ADMIN']);
  if (!admin) return;

  if (req.method === 'GET') {
    const plans = await prisma.investmentPlan.findMany({ orderBy: { createdAt: 'desc' } });
    return res.status(200).json({ plans: plans.map(serialize) });
  }

  if (req.method === 'POST') {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid plan' });
    const data = parsed.data;
    if (data.maximumAmount !== null && data.maximumAmount !== undefined && data.minimumAmount > data.maximumAmount) {
      return res.status(400).json({ error: 'Minimum amount cannot exceed maximum amount' });
    }
    const row = await prisma.investmentPlan.create({ data: {
      ...data,
      minimumAmount: new Prisma.Decimal(data.minimumAmount.toFixed(2)),
      maximumAmount: data.maximumAmount == null ? null : new Prisma.Decimal(data.maximumAmount.toFixed(2)),
      returnRate: new Prisma.Decimal(data.returnRate.toFixed(4)),
      feeRate: new Prisma.Decimal((data.feeRate ?? 0).toFixed(4)),
      calculationMethod: data.calculationMethod ?? 'SIMPLE_FIXED',
      payoutSchedule: data.payoutSchedule ?? 'AT_MATURITY',
      termsVersion: 1
    }});
    return res.status(201).json({ plan: serialize(row) });
  }

  if (req.method === 'PATCH') {
    const id = typeof req.body?.id === 'string' ? req.body.id : null;
    if (!id) return res.status(400).json({ error: 'Plan id required' });
    const parsed = schema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid plan' });
    const data = { ...parsed.data };
    delete data.id;

    // Validate the resulting range, not just the fields supplied in this patch.
    // Otherwise changing only the minimum can leave it above the stored maximum.
    const current = await prisma.investmentPlan.findUnique({
      where: { id },
      select: { minimumAmount: true, maximumAmount: true, name: true, description: true, durationDays: true, returnRate: true, calculationMethod: true, payoutSchedule: true, maturityConditions: true, riskDisclosure: true, feeRate: true, termsVersion: true }
    });
    if (!current) return res.status(404).json({ error: 'Investment plan not found' });

    const minimumAmount = data.minimumAmount ?? Number(current.minimumAmount);
    const maximumAmount = data.maximumAmount !== undefined
      ? data.maximumAmount
      : current.maximumAmount == null ? null : Number(current.maximumAmount);
    if (maximumAmount !== null && maximumAmount !== undefined && minimumAmount > maximumAmount) {
      return res.status(400).json({ error: 'Minimum amount cannot exceed maximum amount' });
    }

    if (data.minimumAmount !== undefined) data.minimumAmount = new Prisma.Decimal(Number(data.minimumAmount).toFixed(2));
    if (data.maximumAmount !== undefined) data.maximumAmount = data.maximumAmount == null ? null : new Prisma.Decimal(Number(data.maximumAmount).toFixed(2));
    if (data.returnRate !== undefined) data.returnRate = new Prisma.Decimal(Number(data.returnRate).toFixed(4));
    if (data.feeRate !== undefined) data.feeRate = new Prisma.Decimal(Number(data.feeRate).toFixed(4));
    const termsFields = ['name','description','minimumAmount','maximumAmount','durationDays','returnRate','calculationMethod','payoutSchedule','maturityConditions','riskDisclosure','feeRate'];
    const changedTerms = termsFields.some(key => data[key] !== undefined && String(data[key] ?? '') !== String(current[key] ?? ''));
    if (changedTerms) data.termsVersion = { increment: 1 };
    const row = await prisma.investmentPlan.update({ where: { id }, data });
    return res.status(200).json({ plan: serialize(row) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
