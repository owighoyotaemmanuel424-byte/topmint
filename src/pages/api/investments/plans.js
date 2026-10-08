import { prisma } from '../../../lib/db/prisma';
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const plans = await prisma.investmentPlan.findMany({ where: { active: true }, orderBy: { minAmount: 'asc' } });
  return res.status(200).json({ plans: plans.map(p => ({ ...p, minAmount: p.minAmount.toString(), maxAmount: p.maxAmount.toString(), returnRate: p.returnRate.toString() })) });
}
