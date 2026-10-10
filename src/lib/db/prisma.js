import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const globalForPrisma = globalThis;

// A connection string pasted into a hosting dashboard's variable editor often
// arrives wrapped in the quotes used in .env files (`"postgresql://..."`), with
// stray surrounding whitespace, or with placeholder text still in it. `new URL()`
// rejects those with ERR_INVALID_URL, which then surfaces from an arbitrary query
// as an opaque `Invalid URL` (for example on sign-in). Normalize and validate once
// here so the adapter only ever sees a clean connection string and a bad value is
// reported as a configuration problem instead.
function normalizeConnectionString(value) {
  if (typeof value !== 'string') return '';
  let normalized = value.trim();
  if (/^(['"]).*\1$/.test(normalized)) normalized = normalized.slice(1, -1).trim();
  return normalized;
}

// The Neon driver adapter speaks to the database over a WebSocket, so the runtime
// has to provide a WebSocket implementation. Node.js 22+ ships one; Node.js 20 and
// older do not (see NODE_VERSION in netlify.toml). Reporting that here keeps the
// failure inside request handling with an actionable message instead of surfacing
// as an anonymous "unable to create your account".
function configurationError(connectionString) {
  if (!connectionString) {
    return new Error('DATABASE_URL is not configured');
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    return new Error(
      'DATABASE_URL is not a valid connection URL. Provide a value like postgresql://USER:PASSWORD@HOST/DATABASE, without surrounding quotes, spaces or placeholder text.',
    );
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    return new Error(`DATABASE_URL must use the postgresql:// protocol, received ${parsed.protocol}`);
  }
  if (!parsed.hostname) {
    return new Error('DATABASE_URL is missing the database host.');
  }
  if (typeof globalThis.WebSocket === 'undefined') {
    return new Error(
      'The Neon driver requires a WebSocket implementation, which this runtime does not provide. Run on Node.js 22+ (NODE_VERSION) or configure neonConfig.webSocketConstructor.',
    );
  }
  return null;
}

const connectionString = normalizeConnectionString(process.env.DATABASE_URL);

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaNeon({ connectionString }),
  });
}

const configError = configurationError(connectionString);

// Keep environment/runtime problems inside request-time code so API handlers can
// return a controlled error instead of failing while the route module loads.
export const prisma =
  globalForPrisma.__topmintPrisma ??
  (configError
    ? new Proxy(
        {},
        {
          get() {
            throw configError;
          },
        },
      )
    : createPrismaClient());

if (process.env.NODE_ENV !== 'production' && !configError) {
  globalForPrisma.__topmintPrisma = prisma;
}
