/**
 * Database foundation verification.
 *
 * Exercises the schema against a real PostgreSQL database and asserts that the
 * guarantees we rely on are actually enforced by the database, not merely
 * described in the Prisma schema:
 *
 *   - connection works
 *   - each core entity can be created
 *   - relationships link correctly
 *   - unique constraints reject duplicates
 *   - foreign keys reject orphans
 *   - onDelete: Restrict protects user profiles
 *   - the expected indexes exist
 *
 * All fixtures use an isolated `verify-<timestamp>` namespace and are removed
 * in a finally block, so the script is safe to re-run and leaves nothing behind.
 *
 * Run with `npm run db:verify`. Never point this at production.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { scriptConnectionString } from "./load-env.js";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = scriptConnectionString;

if (!connectionString) {
  console.error(
    "No database connection string. Set DATABASE_URL in .env.local first.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const run = `verify-${Date.now()}`;
let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  pass  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Asserts that `operation` rejects, i.e. the database refused the write. */
async function expectRejection(label: string, operation: () => Promise<unknown>) {
  try {
    await operation();
    check(label, false, "the write succeeded but should have been rejected");
  } catch {
    check(label, true);
  }
}

async function main() {
  console.log("\nConnection");
  await prisma.$queryRaw`SELECT 1`;
  check("connects and runs a query", true);

  const versionRows = await prisma.$queryRaw<{ version: string }[]>`
    SELECT version() AS version
  `;
  console.log(`        ${versionRows[0]?.version.split(",")[0] ?? "unknown"}`);

  console.log("\nEntity creation");
  const organization = await prisma.organization.create({
    data: { name: "Verification Org", slug: `${run}-org` },
  });
  check("organization created with a UUID id", /^[0-9a-f-]{36}$/i.test(organization.id));
  check("organization defaults to ACTIVE", organization.status === "ACTIVE");
  check(
    "timestamps populated",
    organization.createdAt instanceof Date && organization.updatedAt instanceof Date,
  );

  const user = await prisma.userProfile.create({
    data: { email: `${run}@vyom.local`, fullName: "Verification User" },
  });
  check("user profile created", Boolean(user.id));
  check("authUserId is null before Supabase Auth exists", user.authUserId === null);

  const membership = await prisma.organizationMember.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  check("membership links organization and user", Boolean(membership.id));

  const subscription = await prisma.subscription.create({
    data: { organizationId: organization.id, plan: "FREE", status: "TRIALING" },
  });
  check("subscription attached to organization", Boolean(subscription.id));

  console.log("\nRelationships");
  const loaded = await prisma.organization.findUnique({
    where: { id: organization.id },
    include: { members: { include: { user: true } }, subscription: true },
  });
  check("organization → members resolves", loaded?.members.length === 1);
  check(
    "member → user profile resolves",
    loaded?.members[0]?.user.email === `${run}@vyom.local`,
  );
  check("organization → subscription resolves", loaded?.subscription?.plan === "FREE");

  const reverse = await prisma.userProfile.findUnique({
    where: { id: user.id },
    include: { memberships: { include: { organization: true } } },
  });
  check(
    "user → memberships → organization resolves",
    reverse?.memberships[0]?.organization.slug === `${run}-org`,
  );

  console.log("\nUnique constraints");
  await expectRejection("duplicate organization slug rejected", () =>
    prisma.organization.create({
      data: { name: "Duplicate", slug: `${run}-org` },
    }),
  );
  await expectRejection("duplicate user email rejected", () =>
    prisma.userProfile.create({ data: { email: `${run}@vyom.local` } }),
  );
  await expectRejection("duplicate organization+user membership rejected", () =>
    prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, role: "DIETITIAN" },
    }),
  );
  await expectRejection("second subscription per organization rejected", () =>
    prisma.subscription.create({ data: { organizationId: organization.id } }),
  );

  console.log("\nForeign keys");
  const missingId = "00000000-0000-0000-0000-000000000000";
  await expectRejection("membership with unknown organization rejected", () =>
    prisma.organizationMember.create({
      data: { organizationId: missingId, userId: user.id, role: "DIETITIAN" },
    }),
  );
  await expectRejection("membership with unknown user rejected", () =>
    prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: missingId, role: "DIETITIAN" },
    }),
  );
  await expectRejection("subscription with unknown organization rejected", () =>
    prisma.subscription.create({ data: { organizationId: missingId } }),
  );

  console.log("\nDelete behaviour");
  await expectRejection(
    "user profile with a membership cannot be deleted (onDelete: Restrict)",
    () => prisma.userProfile.delete({ where: { id: user.id } }),
  );

  console.log("\nIndexes");
  const indexes = await prisma.$queryRaw<{ tablename: string; indexname: string }[]>`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
  `;
  const names = indexes.map((row) => row.indexname);
  const expected = [
    "organizations_slug_key",
    "organizations_status_created_at_idx",
    "user_profiles_email_key",
    "user_profiles_auth_user_id_key",
    "organization_members_organization_id_user_id_key",
    "organization_members_organization_id_role_idx",
    "organization_members_user_id_idx",
    "subscriptions_organization_id_key",
    "subscriptions_status_trial_ends_at_idx",
  ];
  for (const index of expected) {
    check(index, names.includes(index));
  }

  console.log("\nTimestamps");
  const before = organization.updatedAt.getTime();
  await new Promise((resolve) => setTimeout(resolve, 15));
  const renamed = await prisma.organization.update({
    where: { id: organization.id },
    data: { name: "Verification Org (renamed)" },
  });
  check("updatedAt advances on write", renamed.updatedAt.getTime() > before);

  const columnRows = await prisma.$queryRaw<{ tz: string }[]>`
    SELECT data_type AS tz
    FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'created_at'
  `;
  check(
    "timestamps stored with time zone (UTC-safe)",
    columnRows[0]?.tz === "timestamp with time zone",
  );
}

main()
  .catch((error) => {
    failed += 1;
    console.error("\nVerification threw:", error);
  })
  .finally(async () => {
    // Clean up in dependency order. Memberships and subscriptions cascade from
    // the organization; the user profile is Restrict-protected so it goes last.
    await prisma.organizationMember
      .deleteMany({ where: { organization: { slug: { startsWith: "verify-" } } } })
      .catch(() => {});
    await prisma.organization
      .deleteMany({ where: { slug: { startsWith: "verify-" } } })
      .catch(() => {});
    await prisma.userProfile
      .deleteMany({ where: { email: { startsWith: "verify-" } } })
      .catch(() => {});

    await prisma.$disconnect();

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
