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
  active: z.boolean().optional()
});

const serialize = p => ({
  ...p,
  minimumAmount: p.minimumAmount.toString(),
  maximumAmount: p.maximumAmount?.toString() ?? null,
  returnRate: p.returnRate.toString()
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
      returnRate: new Prisma.Decimal(data.returnRate.toFixed(4))
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
    if (data.minimumAmount !== undefined) data.minimumAmount = new Prisma.Decimal(Number(data.minimumAmount).toFixed(2));
    if (data.maximumAmount !== undefined) data.maximumAmount = data.maximumAmount == null ? null : new Prisma.Decimal(Number(data.maximumAmount).toFixed(2));
    if (data.returnRate !== undefined) data.returnRate = new Prisma.Decimal(Number(data.returnRate).toFixed(4));
    const row = await prisma.investmentPlan.update({ where: { id }, data });
    return res.status(200).json({ plan: serialize(row) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
