import { prisma, databaseConfigError, databaseDiagnostics } from '../../lib/db/prisma';
import { classifyDatabaseError, configHint } from '../../lib/db-error';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Configuration is resolved while the module loads, before any query runs, so a
  // deployment missing an environment variable reports exactly what is wrong here.
  // Only variable names and problem categories are exposed, never a value, and never
  // any part of the connection string — this route is public.
  if (databaseConfigError) {
    return res.status(503).json({
      ok: false,
      database: 'error',
      code: classifyDatabaseError(databaseConfigError, 'DATABASE_CONFIG_ERROR'),
      reason: databaseDiagnostics.problem,
      source: databaseDiagnostics.source,
      checkedVariables: databaseDiagnostics.checkedVariables,
      hint: configHint(databaseConfigError),
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({
      ok: true,
      database: 'ok',
      source: databaseDiagnostics.source,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Only the failure category is exposed, never the underlying message, which can
    // contain connection details.
    const hint = configHint(error);
    return res.status(503).json({
      ok: false,
      database: 'error',
      code: classifyDatabaseError(error),
      source: databaseDiagnostics.source,
      ...(hint ? { hint } : {}),
    });
  }
}
