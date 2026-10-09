import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const globalForPrisma = globalThis;

// The Neon driver adapter speaks to the database over a WebSocket, so the runtime
// has to provide a WebSocket implementation. Node.js 22+ ships one; Node.js 20 and
// older do not (see NODE_VERSION in netlify.toml). Reporting that here keeps the
// failure inside request handling with an actionable message instead of surfacing
// as an anonymous "unable to create your account".
function configurationError() {
  if (!process.env.DATABASE_URL) {
    return new Error('DATABASE_URL is not configured');
  }
  if (typeof globalThis.WebSocket === 'undefined') {
    return new Error(
      'The Neon driver requires a WebSocket implementation, which this runtime does not provide. Run on Node.js 22+ (NODE_VERSION) or configure neonConfig.webSocketConstructor.',
    );
  }
  return null;
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
  });
}

const configError = configurationError();

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
