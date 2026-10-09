import { prisma } from '../../lib/db/prisma';
import { classifyDatabaseError } from '../../lib/db-error';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ ok: true, database: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    // Only the failure category is exposed, never the underlying message, which can
    // contain connection details.
    return res.status(503).json({ ok: false, database: 'error', code: classifyDatabaseError(error) });
  }
}
