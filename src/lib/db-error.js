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
  // Covers a missing, malformed or quote-wrapped connection string. Prisma wraps a
  // URL parse failure as PrismaClientKnownRequestError with code ERR_INVALID_URL
  // and the message "Invalid URL", so match those here rather than letting it fall
  // through to a generic failure.
  if (code === 'ERR_INVALID_URL' || /DATABASE_URL (is|must)|Invalid URL/i.test(message)) return 'DATABASE_CONFIG_ERROR';
  if (/JWT_SECRET is not configured|ADMIN_JWT_SECRET is not configured/i.test(message)) return 'AUTH_CONFIG_ERROR';
  // The Neon driver adapter talks to the database over a WebSocket. A runtime with
  // neither a global WebSocket nor the `ws` fallback (src/lib/db/prisma.js) fails
  // every query this way.
  if (/WebSocket/i.test(message)) return 'DATABASE_RUNTIME_ERROR';
  if (name === 'PrismaClientInitializationError' || name === 'ErrorEvent' || NETWORK_PATTERN.test(message)) {
    return 'DATABASE_CONNECTION_ERROR';
  }

  return fallback;
}

// A short, non-sensitive explanation of a *configuration* failure, so a deployment
// that lost an environment variable can be fixed from the error message itself
// without reading server logs. Derived from the messages raised by
// src/lib/db/prisma.js and src/lib/auth.js; never echoes any variable value.
export function configHint(error) {
  const message = String(error?.message || '');
  if (/DATABASE_URL is not configured/i.test(message)) return 'DATABASE_URL is not set on this deployment';
  if (/not a valid connection URL/i.test(message)) return 'DATABASE_URL is not a valid connection URL';
  if (/must use the postgresql/i.test(message)) return 'DATABASE_URL must start with postgresql://';
  if (/missing the database host/i.test(message)) return 'DATABASE_URL is missing the database host';
  if (/WebSocket/i.test(message)) return 'this deployment has no WebSocket support for the Neon driver';
  if (/ADMIN_JWT_SECRET is not configured/i.test(message)) return 'ADMIN_JWT_SECRET is not set on this deployment';
  if (/JWT_SECRET is not configured/i.test(message)) return 'JWT_SECRET is not set on this deployment';
  return '';
}

// The JSON body every route returns for an unexpected failure. `hint` is only
// present for configuration problems, where it is actionable and safe to expose.
export function errorBody(error, { fallback = 'SERVER_ERROR', message = 'This service is temporarily unavailable. Please try again shortly.' } = {}) {
  const code = classifyDatabaseError(error, fallback);
  const hint = configHint(error);
  return hint ? { error: message, code, hint } : { error: message, code };
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
  return res.status(status).json(errorBody(error, { fallback, message }));
}
