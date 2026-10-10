// Shared classification for database failures. API routes use this to return a
// specific, non-sensitive error code instead of a generic "something went wrong",
// and /api/health reports the same code so a broken deployment can be diagnosed
// without reading server logs.

const SCHEMA_CODES = new Set(['P2021', 'P2022']);
const CONNECTION_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1010', 'P1011', 'P1017']);
const NETWORK_PATTERN = /fetch failed|socket hang up|network error|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo|non-101 status code/i;

export function classifyDatabaseError(error, fallback = 'UNKNOWN') {
  const code = error?.code;
  const name = String(error?.name || '');
  const message = String(error?.message || '');

  if (code === 'P2002') return 'ACCOUNT_EXISTS';
  if (SCHEMA_CODES.has(code)) return 'DATABASE_SCHEMA_MISMATCH';
  if (CONNECTION_CODES.has(code)) return 'DATABASE_CONNECTION_ERROR';
  if (/DATABASE_URL is not configured/i.test(message)) return 'DATABASE_CONFIG_ERROR';
  if (/JWT_SECRET is not configured|ADMIN_JWT_SECRET is not configured/i.test(message)) return 'AUTH_CONFIG_ERROR';
  // The Neon driver adapter talks to the database over a WebSocket. Runtimes without
  // a global WebSocket (Node.js < 22, no `ws` installed) fail every query this way.
  if (/WebSocket/i.test(message)) return 'DATABASE_RUNTIME_ERROR';
  if (name === 'PrismaClientInitializationError' || name === 'ErrorEvent' || NETWORK_PATTERN.test(message)) {
    return 'DATABASE_CONNECTION_ERROR';
  }

  return fallback;
}

// One place for API routes to turn an unexpected failure into a JSON response.
// An error that escapes the handler produces a plain-text/HTML error page from the
// hosting layer, which client code cannot parse (see src/lib/api-client.js), so
// every route that touches the database answers through here instead.
export function respondWithError(res, error, {
  fallback = 'SERVER_ERROR',
  status = 503,
  message = 'This service is temporarily unavailable. Please try again shortly.',
} = {}) {
  const code = classifyDatabaseError(error, fallback);
  console.error('api error', { code, name: error?.name, prismaCode: error?.code, message: error?.message });
  return res.status(status).json({ error: message, code });
}
