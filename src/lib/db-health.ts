import "server-only";

import { isDatabaseConfigured } from "@/config/env.server";
import { prisma } from "@/lib/prisma";

export type DatabaseHealth =
  | { state: "not-configured" }
  | { state: "connected"; server: string; migrationsApplied: number }
  | { state: "error"; reason: string };

/**
 * Server-side database connection check.
 *
 * Reports only whether the connection works and how many migrations are
 * applied. It never returns the connection string, credentials, host, or a raw
 * driver error — those would leak infrastructure detail into a rendered page.
 * Full errors go to the server log instead.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  if (!isDatabaseConfigured()) {
    return { state: "not-configured" };
  }

  try {
    const versionRows = await prisma.$queryRaw<{ version: string }[]>`
      SELECT version() AS version
    `;

    const migrationRows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    `;

    // Both queries return exactly one row, but the array type cannot express
    // that; fall back rather than assert non-null.
    const version = versionRows[0]?.version ?? "PostgreSQL";
    const count = migrationRows[0]?.count ?? 0n;

    return {
      state: "connected",
      // Just the product and version, e.g. "PostgreSQL 17.5" — no host details.
      server: version.split(" ").slice(0, 2).join(" "),
      migrationsApplied: Number(count),
    };
  } catch (error) {
    console.error("Database health check failed:", error);
    return {
      state: "error",
      reason: "Could not reach the database. Check the server log for details.",
    };
  }
}
