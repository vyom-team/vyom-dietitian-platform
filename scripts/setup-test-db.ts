/**
 * Prepares the disposable database used by the Row Level Security tests.
 *
 *   1. Installs the Supabase `auth` stub (schema, roles, `auth.uid()`)
 *   2. Applies every Prisma migration
 *
 * Run with `npm run test:setup`. Requires RLS_TEST_DATABASE_URL.
 *
 * Refuses to run against anything that looks like a managed or hosted database:
 * this script drops and recreates schemas, and pointing it at a real
 * environment would destroy data.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { Client } from "pg";

import "./load-env.js";

const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

if (!url) {
  console.error(
    "RLS_TEST_DATABASE_URL is not set.\n\n" +
      "Start a disposable PostgreSQL and point it there:\n" +
      "  docker run -d --name vyom-test-pg -e POSTGRES_PASSWORD=postgres \\\n" +
      "    -e POSTGRES_DB=vyom_test -p 55432:5432 postgres:17-alpine\n\n" +
      '  RLS_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:55432/vyom_test"',
  );
  process.exit(1);
}

const host = new URL(url).hostname;
const isLocal = ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(
  host,
);

if (!isLocal) {
  console.error(
    `Refusing to run against a non-local host (${host}).\n` +
      "This script drops and recreates schemas. Use a throwaway local database.",
  );
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();

  console.log(`Resetting schemas on ${host}…`);
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("DROP SCHEMA IF EXISTS auth CASCADE");
  await client.query("DROP SCHEMA IF EXISTS vyom_private CASCADE");
  await client.query("CREATE SCHEMA public");

  console.log("Installing the Supabase auth stub…");
  await client.query(readFileSync("prisma/shadow-init.sql", "utf8"));

  await client.end();

  console.log("Applying migrations…");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DIRECT_URL: url, DATABASE_URL: url },
  });

  console.log("\nTest database ready. Run `npm test`.");
}

main().catch((error) => {
  console.error("Setup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
