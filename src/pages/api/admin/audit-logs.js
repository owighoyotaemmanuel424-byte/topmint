import { requireAdmin } from '../../../lib/admin-auth';
import { prisma } from '../../../lib/db/prisma';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res, ['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const logs = await prisma.auditLog.findMany({
    where: { adminId: admin.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { admin: { select: { name: true, email: true } } }
  });

  return res.status(200).json({ logs });
}
