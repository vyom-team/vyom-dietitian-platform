/**
 * Development seed — synthetic technical fixtures only.
 *
 * Everything created here is obviously non-real ("Development Practice",
 * dev@vyom.local) so it can never be mistaken for customer data. This script
 * deliberately creates **no** clients, health information, or nutrition values:
 * those must originate from real records and approved reference sources, never
 * from a seed file.
 *
 * Its purpose is to prove the tenant → member → subscription relationships work
 * end to end. Run with `npm run db:seed`.
 *
 * Safe to re-run: every write is an upsert keyed on a unique column.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { scriptConnectionString } from "../scripts/load-env.js";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = scriptConnectionString;

if (!connectionString) {
  console.error(
    "No database connection string. Set DATABASE_URL in .env.local first.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEV_ORG_SLUG = "development-practice";
const DEV_USER_EMAIL = "dev@vyom.local";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed a production database. Seed data is development-only.",
    );
  }

  const organization = await prisma.organization.upsert({
    where: { slug: DEV_ORG_SLUG },
    update: {},
    create: {
      name: "Development Practice",
      slug: DEV_ORG_SLUG,
      status: "ACTIVE",
    },
  });

  const user = await prisma.userProfile.upsert({
    where: { email: DEV_USER_EMAIL },
    update: {},
    create: {
      email: DEV_USER_EMAIL,
      fullName: "Development User",
      // authUserId stays null: no Supabase Auth user exists until Phase 3.
    },
  });

  const membership = await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date(),
    },
  });

  const subscription = await prisma.subscription.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: {
      organizationId: organization.id,
      plan: "FREE",
      status: "TRIALING",
      trialStartsAt: new Date(),
    },
  });

  console.log("Seeded development fixtures:");
  console.log(`  organization  ${organization.slug} (${organization.id})`);
  console.log(`  user profile  ${user.email} (${user.id})`);
  console.log(`  membership    ${membership.role} / ${membership.status}`);
  console.log(`  subscription  ${subscription.plan} / ${subscription.status}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
