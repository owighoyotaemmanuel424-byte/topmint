import { prisma } from '../../lib/db/prisma';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ ok: true, database: 'ok', timestamp: new Date().toISOString() });
  } catch {
    return res.status(503).json({ ok: false, database: 'error' });
  }
}
