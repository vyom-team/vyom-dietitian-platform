/**
 * Nutrition registry sync.
 *
 *   npm run nutrition:registry
 *
 * Projects the vocabulary defined in `src/lib/nutrition/` into the database:
 * sources, nutrients, units, and the two SI unit conversions.
 *
 * WRITES NO NUTRITION DATA. No food, no nutrient value, no portion weight —
 * only the words those things are described in. Everything measurable comes
 * from a dataset import, with provenance.
 *
 * Safe to run repeatedly. Licence and permission statuses are written once at
 * creation and never reset by a later run, so a recorded review decision
 * cannot be undone by re-running this.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { scriptConnectionString } from "../load-env.js";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { syncNutritionRegistry } from "../../src/services/nutrition/registry.js";

const connectionString = scriptConnectionString;

if (!connectionString) {
  console.error(
    "No database connection string. Set DATABASE_URL in .env.local first.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const result = await syncNutritionRegistry(prisma);

  console.log("");
  console.log("Nutrition registry sync");
  console.log("=======================");
  console.log("");
  console.log(`  Sources       ${result.sourcesCreated} created, ${result.sourcesUpdated} refreshed`);
  console.log(`  Nutrients     ${result.nutrientsCreated} created, ${result.nutrientsUpdated} refreshed`);
  console.log(`  Units         ${result.unitsCreated} created, ${result.unitsUpdated} refreshed`);
  console.log(`  Conversions   ${result.conversionsCreated} created, ${result.conversionsUpdated} refreshed`);
  console.log("");

  const sources = await prisma.nutritionSource.findMany({
    select: { code: true, permissionStatus: true, commercialUseStatus: true },
    orderBy: { code: "asc" },
  });

  console.log("  Licence status");
  for (const source of sources) {
    console.log(
      `    ${source.code.padEnd(14)} permission: ${source.permissionStatus.padEnd(17)} commercial use: ${source.commercialUseStatus}`,
    );
  }
  console.log("");
  console.log("  No dataset here has been cleared for commercial use. Review is");
  console.log("  required before launch — see docs/nutrition-data.md.");
  console.log("");
}

main()
  .catch((error: unknown) => {
    console.error("\nRegistry sync failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
