import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const globalForPrisma = globalThis;

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
}

// Keep missing environment configuration inside request-time code so API handlers
// can return a controlled error instead of failing while the route module loads.
export const prisma =
  globalForPrisma.__topmintPrisma ??
  (process.env.DATABASE_URL
    ? createPrismaClient()
    : new Proxy({}, {
        get() {
          throw new Error('DATABASE_URL is not configured');
        },
      }));

if (process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL) {
  globalForPrisma.__topmintPrisma = prisma;
}
