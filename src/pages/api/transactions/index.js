import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const rows = await prisma.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: limit });
  return res.status(200).json({ transactions: rows.map(t => ({ ...t, amount: t.amount.toString() })) });
}
