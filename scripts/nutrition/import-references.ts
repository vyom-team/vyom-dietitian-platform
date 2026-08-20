/**
 * Reference-value import CLI.
 *
 *   npm run nutrition:import-references -- --manifest icmr-rda-2020.json
 *   npm run nutrition:import-references -- --manifest icmr-rda-2020.json --dry-run
 *
 * This is how Phase 8D's targets stop reporting REFERENCE_REQUIRED. Both the
 * manifest and the data file it names live in NUTRITION_DATA_DIR (default
 * `data/nutrition`, git-ignored); nothing is read from anywhere else.
 *
 * **Run --dry-run first.** These are clinical figures, and the dry run reports
 * every row it would reject without writing anything.
 *
 * Safe to run repeatedly: writes are keyed on each rule's own applicability, so
 * a second run updates what the first created.
 */

import { readFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";

import { scriptConnectionString } from "../load-env.js";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import {
  displayFileName,
  nutritionDataDir,
  resolveDatasetFile,
} from "../../src/lib/nutrition/data-dir.js";
import {
  formatReferenceImportReport,
  runReferenceImport,
} from "../../src/services/nutrition/import-references.js";
import { parseReferenceManifest } from "../../src/validations/nutrition-reference.js";

const connectionString = scriptConnectionString;

if (!connectionString) {
  console.error("No database connection string. Set DATABASE_URL in .env.local first.");
  process.exit(1);
}

function argument(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index !== -1) return process.argv[index + 1];

  const inline = process.argv.find((value) => value.startsWith(`${flag}=`));
  return inline?.slice(flag.length + 1);
}

const manifestName = argument("manifest");
const dryRun = process.argv.includes("--dry-run");

if (!manifestName) {
  console.error(
    [
      "Usage: npm run nutrition:import-references -- --manifest <file.json> [--dry-run]",
      "",
      `Manifests and data files are read from ${nutritionDataDir()}`,
      "See docs/nutrition-targets.md for the manifest format.",
    ].join("\n"),
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const manifestPath = resolveDatasetFile(manifestName!);
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;

  const parsed = parseReferenceManifest(raw);

  if (!parsed.ok) {
    console.error(`\nManifest ${displayFileName(manifestName!)} is not valid:\n`);
    for (const error of parsed.errors) console.error(`  - ${error}`);
    console.error("");
    process.exitCode = 1;
    return;
  }

  const dataPath = resolveDatasetFile(parsed.manifest.file);
  const fileContents = readFileSync(dataPath, "utf8");

  const result = await runReferenceImport({
    prisma,
    manifest: parsed.manifest,
    fileContents,
    dryRun,
  });

  console.log(formatReferenceImportReport(result));

  if (result.failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("\nImport failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
