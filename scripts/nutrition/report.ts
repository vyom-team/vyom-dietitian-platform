/**
 * Nutrition data quality report.
 *
 *   npm run nutrition:report
 *
 * Reads what is actually in the database and says so. Every figure is a query
 * result — nothing here is estimated, and if no dataset has been imported the
 * report says zero rather than inventing a plausible number.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { scriptConnectionString } from "../load-env.js";
import { PrismaClient } from "../../src/generated/prisma/client.js";

const connectionString = scriptConnectionString;

if (!connectionString) {
  console.error(
    "No database connection string. Set DATABASE_URL in .env.local first.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function pad(value: number): string {
  return value.toLocaleString("en-IN").padStart(8);
}

async function main() {
  console.log("");
  console.log("Vyom nutrition data quality report");
  console.log("==================================");

  const sources = await prisma.nutritionSource.findMany({
    orderBy: { code: "asc" },
    select: {
      code: true,
      name: true,
      permissionStatus: true,
      commercialUseStatus: true,
      redistributionStatus: true,
      versions: {
        orderBy: { version: "asc" },
        select: {
          id: true,
          version: true,
          importedAt: true,
          _count: { select: { foodNutrients: true, sourceFoods: true, foodsOriginated: true } },
        },
      },
    },
  });

  if (sources.length === 0) {
    console.log("");
    console.log("  No sources registered. Run: npm run nutrition:registry");
    console.log("");
    return;
  }

  for (const source of sources) {
    console.log("");
    console.log(`  ${source.name} (${source.code})`);
    console.log(
      `    permission: ${source.permissionStatus}   commercial: ${source.commercialUseStatus}   redistribution: ${source.redistributionStatus}`,
    );

    if (source.versions.length === 0) {
      console.log("    no versions registered");
      continue;
    }

    for (const version of source.versions) {
      const imported = version.importedAt
        ? version.importedAt.toISOString().slice(0, 10)
        : "never imported";
      console.log(`    version ${version.version}  (${imported})`);
      console.log(`      foods            ${pad(version._count.foodsOriginated)}`);
      console.log(`      nutrient values  ${pad(version._count.foodNutrients)}`);
      console.log(`      source records   ${pad(version._count.sourceFoods)}`);
    }
  }

  const [
    totalFoods,
    activeFoods,
    totalValues,
    totalAliases,
    unmapped,
    needsReview,
    rejected,
    nutrients,
    units,
    conversions,
  ] = await Promise.all([
    prisma.food.count(),
    prisma.food.count({ where: { isActive: true } }),
    prisma.foodNutrient.count(),
    prisma.foodAlias.count(),
    prisma.sourceFood.count({ where: { mappingStatus: "UNMAPPED" } }),
    prisma.sourceFood.count({ where: { mappingStatus: "REVIEW_REQUIRED" } }),
    prisma.sourceFood.count({ where: { mappingStatus: "REJECTED" } }),
    prisma.nutrient.count(),
    prisma.unit.count(),
    prisma.unitConversion.count(),
  ]);

  console.log("");
  console.log("  Totals");
  console.log(`    foods                ${pad(totalFoods)}  (${activeFoods} active)`);
  console.log(`    nutrient values      ${pad(totalValues)}`);
  console.log(`    aliases              ${pad(totalAliases)}`);
  console.log(`    nutrients defined    ${pad(nutrients)}`);
  console.log(`    units defined        ${pad(units)}`);
  console.log(`    unit conversions     ${pad(conversions)}`);

  console.log("");
  console.log("  Mapping backlog");
  console.log(`    unmapped             ${pad(unmapped)}`);
  console.log(`    needs review         ${pad(needsReview)}`);
  console.log(`    rejected             ${pad(rejected)}`);

  /*
   * Coverage: how many of the possible (food × nutrient) pairs a source
   * actually published. This is the missing-versus-zero rule made visible —
   * every absent pair is a value the source did not provide, and none of them
   * is stored as a zero.
   */
  if (totalFoods > 0 && nutrients > 0) {
    const possible = totalFoods * nutrients;
    const percent = ((totalValues / possible) * 100).toFixed(1);
    console.log("");
    console.log("  Nutrient coverage");
    console.log(`    recorded             ${pad(totalValues)} of ${possible.toLocaleString("en-IN")} possible (${percent}%)`);
    console.log(`    not published        ${pad(possible - totalValues)}  — absent, not zero`);
  }

  const imports = await prisma.datasetImport.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
    select: {
      status: true,
      startedAt: true,
      inputFile: true,
      recordsRead: true,
      recordsImported: true,
      recordsSkipped: true,
      recordsFailed: true,
      dryRun: true,
      sourceVersion: { select: { version: true, source: { select: { code: true } } } },
    },
  });

  console.log("");
  console.log("  Recent imports");
  if (imports.length === 0) {
    console.log("    none");
  } else {
    for (const run of imports) {
      const when = run.startedAt.toISOString().slice(0, 16).replace("T", " ");
      const label = `${run.sourceVersion.source.code} ${run.sourceVersion.version}`;
      console.log(
        `    ${when}  ${label.padEnd(18)} ${run.status.padEnd(10)}${run.dryRun ? " (dry run)" : ""}`,
      );
      console.log(
        `      file ${run.inputFile ?? "—"}  read ${run.recordsRead}, imported ${run.recordsImported}, skipped ${run.recordsSkipped}, failed ${run.recordsFailed}`,
      );
    }
  }

  console.log("");
}

main()
  .catch((error: unknown) => {
    console.error("\nReport failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
