/**
 * Dataset import CLI.
 *
 *   npm run nutrition:import -- --manifest ifct-2017.json
 *   npm run nutrition:import -- --manifest ifct-2017.json --dry-run
 *
 * Both the manifest and the data file it names live in NUTRITION_DATA_DIR
 * (default `data/nutrition`, git-ignored). Nothing is read from anywhere else:
 * raw datasets stay out of the web application, and the importer will not
 * follow a path out of that directory.
 *
 * Safe to run repeatedly. Every write is keyed on the publisher's own
 * identifiers, so a second run matches what the first created rather than
 * duplicating it.
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
import { formatImportReport } from "../../src/lib/nutrition/ingest/report.js";
import { runDatasetImport } from "../../src/services/nutrition/import.js";
import { parseDatasetManifest } from "../../src/validations/nutrition.js";

const connectionString = scriptConnectionString;

if (!connectionString) {
  console.error(
    "No database connection string. Set DATABASE_URL in .env.local first.",
  );
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
      "Usage: npm run nutrition:import -- --manifest <file.json> [--dry-run]",
      "",
      `Manifests and data files are read from ${nutritionDataDir()}`,
      "See docs/nutrition-data.md for the manifest format.",
    ].join("\n"),
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  if (!manifestName) return;

  const manifestPath = resolveDatasetFile(manifestName);

  let manifestText: string;
  try {
    manifestText = readFileSync(manifestPath, "utf8");
  } catch {
    console.error(
      [
        `Cannot read manifest "${manifestName}".`,
        "",
        `Expected it in: ${nutritionDataDir()}`,
        "",
        "That directory is git-ignored and starts empty — the datasets are not",
        "ours to commit. See docs/nutrition-data.md for what to put there.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const parsed = parseDatasetManifest(JSON.parse(manifestText));

  if (!parsed.ok) {
    console.error(`\nManifest "${manifestName}" is not valid:\n`);
    for (const issue of parsed.errors) console.error(`  - ${issue}`);
    console.error("");
    process.exitCode = 1;
    return;
  }

  const dataPath = resolveDatasetFile(parsed.manifest.file);

  let contents: string;
  try {
    contents = readFileSync(dataPath, "utf8");
  } catch {
    console.error(
      `Cannot read data file "${parsed.manifest.file}" named by the manifest.`,
    );
    process.exitCode = 1;
    return;
  }

  const result = await runDatasetImport({
    prisma,
    manifest: parsed.manifest,
    contents,
    fileName: displayFileName(dataPath),
    dryRun,
  });

  console.log(
    formatImportReport({
      sourceCode: parsed.manifest.source,
      sourceName: result.sourceName,
      version: parsed.manifest.version,
      fileName: displayFileName(dataPath),
      checksum: result.checksum,
      dryRun,
      statistics: result.statistics,
      diagnostics: result.diagnostics,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
    }),
  );

  console.log(`  Status            ${result.status}`);
  console.log(`  Import id         ${result.importId}`);
  console.log("");

  // A partial import is a real outcome, not a success: the exit code has to
  // say so, or a CI pipeline will treat a half-imported dataset as fine.
  if (result.status === "FAILED") process.exitCode = 1;
  else if (result.status === "PARTIAL") process.exitCode = 2;
}

main()
  .catch((error: unknown) => {
    console.error("\nImport failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
