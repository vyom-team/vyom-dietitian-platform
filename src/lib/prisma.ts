import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnv, isDevelopment } from "@/config/env.server";

/**
 * Shared Prisma client.
 *
 * `import "server-only"` is load-bearing: importing this module from a client
 * component becomes a build error rather than a leaked connection string.
 * Never remove it.
 *
 * Prisma 7 requires a driver adapter for SQL databases. The adapter receives
 * DATABASE_URL — the pooled Supabase connection — because application queries
 * are short-lived. Migrations use DIRECT_URL instead; see prisma.config.ts.
 */

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: getServerEnv().DATABASE_URL,
  });

  return new PrismaClient({
    adapter,
    // Query logs are noisy; warnings and errors are not.
    log: isDevelopment ? ["warn", "error"] : ["error"],
  });
}

/**
 * Next.js discards the module registry on every hot reload in development. A
 * plain module-level client would open a new pool on each edit and exhaust the
 * database's connection limit within minutes, so the instance is parked on
 * globalThis, which survives reloads.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const client = createPrismaClient();
  if (!isDevelopment) return client;

  globalForPrisma.prisma = client;
  return client;
}

/**
 * The client is constructed on first property access, not at import.
 *
 * This matters while the database is still optional: a module can import
 * `prisma` and the app boots fine with no `.env.local`. Only code that actually
 * runs a query hits the missing-configuration error.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient(), property, receiver);
  },
}) satisfies PrismaClient;
