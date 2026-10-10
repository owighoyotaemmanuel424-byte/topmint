import * as ws from 'ws';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const globalForPrisma = globalThis;

// A connection string pasted into a hosting dashboard's variable editor often
// arrives wrapped in the quotes used in .env files (`"postgresql://..."`), with
// stray surrounding whitespace, or as the whole `DATABASE_URL="..."` line. `new URL()`
// rejects those with ERR_INVALID_URL, which then surfaces from an arbitrary query
// as an opaque `Invalid URL` (for example on sign-in). Normalize and validate once
// here so the adapter only ever sees a clean connection string and a bad value is
// reported as a configuration problem instead.
export function normalizeConnectionString(value) {
  if (typeof value !== 'string') return '';
  let normalized = value.trim();
  if (/^export\s+/i.test(normalized)) normalized = normalized.replace(/^export\s+/i, '');
  // `DATABASE_URL=postgresql://...` (or any `NAME=value` line) keeps the assignment
  // when copied out of a .env file. A bare URL never matches: the identifier has to
  // be followed by `=` before the protocol's `:`.
  const assignment = normalized.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*([\s\S]*)$/);
  if (assignment) normalized = assignment[1].trim();
  if (/^(['"]).*\1$/.test(normalized)) normalized = normalized.slice(1, -1).trim();
  return normalized;
}

// Names a hosting dashboard may use for the same Neon connection string. `DATABASE_URL`
// always wins; the others only cover a dashboard/Neon integration that named the
// variable differently. /api/health reports which one was used, so a value that came
// from an unexpected variable is visible instead of silent.
const CONNECTION_VARIABLES = ['DATABASE_URL', 'POSTGRES_PRISMA_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL'];

function readConnectionString() {
  for (const name of CONNECTION_VARIABLES) {
    const value = normalizeConnectionString(process.env[name]);
    if (value) return { name, value };
  }
  return { name: null, value: '' };
}

// The Neon driver adapter speaks to the database over a WebSocket, so the runtime has
// to provide a WebSocket implementation. Node.js 22+ ships one; Node.js 20 and older
// do not, and every query fails there. `ws` is a direct dependency for exactly this
// case, so a deployment no longer depends on which Node.js version the host picked.
function resolveWebSocketConstructor() {
  if (typeof globalThis.WebSocket !== 'undefined') return globalThis.WebSocket;
  // `ws` is CommonJS: depending on the bundler `WebSocket` is either a named export
  // or the module's default export.
  return ws.WebSocket ?? ws.default ?? null;
}

const WebSocketConstructor = resolveWebSocketConstructor();
if (WebSocketConstructor) neonConfig.webSocketConstructor = WebSocketConstructor;

// Returns a machine-readable problem id plus the error the API layer should see.
// Messages are what `classifyDatabaseError` and `configHint` (src/lib/db-error.js)
// match on, so they carry the variable name and never the connection string itself.
function findConfigurationProblem(connectionString) {
  if (!connectionString) {
    return {
      problem: 'MISSING_CONNECTION_STRING',
      error: new Error(
        `DATABASE_URL is not configured. Set it in this deployment's environment variables (checked ${CONNECTION_VARIABLES.join(', ')}).`,
      ),
    };
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    return {
      problem: 'INVALID_CONNECTION_URL',
      error: new Error(
        'DATABASE_URL is not a valid connection URL. Provide a value like postgresql://USER:PASSWORD@HOST/DATABASE, without surrounding quotes, spaces or placeholder text.',
      ),
    };
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    return {
      problem: 'WRONG_PROTOCOL',
      error: new Error(`DATABASE_URL must use the postgresql:// protocol, received ${parsed.protocol}`),
    };
  }
  if (!parsed.hostname) {
    return { problem: 'MISSING_HOST', error: new Error('DATABASE_URL is missing the database host.') };
  }
  if (!WebSocketConstructor) {
    return {
      problem: 'NO_WEBSOCKET',
      error: new Error(
        'The Neon driver requires a WebSocket implementation, which this runtime does not provide. Run on Node.js 22+ or install the `ws` package.',
      ),
    };
  }
  return { problem: 'NONE', error: null };
}

const connection = readConnectionString();
const configuration = findConfigurationProblem(connection.value);

// Safe to expose: names and categories only, never any part of the connection string.
// /api/health reports this so a broken deployment can be diagnosed from the browser.
export const databaseDiagnostics = {
  source: connection.name,
  problem: configuration.problem,
  checkedVariables: CONNECTION_VARIABLES,
};

export const databaseConfigError = configuration.error;

// Keep environment/runtime problems inside request-time code so API handlers can
// return a controlled error instead of failing while the route module loads.
export const prisma =
  globalForPrisma.__topmintPrisma ??
  (configuration.error
    ? new Proxy(
        {},
        {
          get() {
            throw configuration.error;
          },
        },
      )
    : new PrismaClient({ adapter: new PrismaNeon({ connectionString: connection.value }) }));

if (process.env.NODE_ENV !== 'production' && !configuration.error) {
  globalForPrisma.__topmintPrisma = prisma;
}
