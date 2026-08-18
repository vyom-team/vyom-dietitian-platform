/**
 * Adapter-driven dataset import.
 *
 *   npm run nutrition:import-source -- --source INDB --version 2024.11 \
 *       --file indb/Anuvaad_INDB_2024.11.xlsx
 *
 *   npm run nutrition:import-source -- --source INDB --version 2024.11 \
 *       --file indb/Anuvaad_INDB_2024.11.xlsx --dry-run
 *
 * The manifest route (`nutrition:import`) serves datasets that are one flat
 * table of nutrient columns. This route serves the ones that are not — where a
 * publisher's layout needs real code, and that code belongs in an adapter.
 *
 * Files are read from NUTRITION_DATA_DIR and nowhere else. Nothing is
 * downloaded, and the importer will not follow a path out of that directory.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { scriptConnectionString } from "../load-env.js";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { availableAdapters, getAdapter } from "../../src/lib/nutrition/adapters/index.js";
import {
  displayFileName,
  nutritionDataDir,
  resolveDatasetFile,
} from "../../src/lib/nutrition/data-dir.js";
import { parseCsv } from "../../src/lib/nutrition/ingest/csv.js";
import { formatImportReport } from "../../src/lib/nutrition/ingest/report.js";
import type { ParsedFile } from "../../src/lib/nutrition/ingest/types.js";
import { runAdapterImport } from "../../src/services/nutrition/import.js";
import { readXlsx } from "./read-xlsx.js";

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

const sourceCode = argument("source");
const version = argument("version");
const file = argument("file");
const sheet = argument("sheet");
const dryRun = process.argv.includes("--dry-run");

if (!sourceCode || !version || !file) {
  console.error(
    [
      "Usage: npm run nutrition:import-source -- --source <CODE> --version <VERSION> --file <path> [--sheet <name>] [--dry-run]",
      "",
      `Adapters available: ${availableAdapters().join(", ") || "(none)"}`,
      `Files are read from: ${nutritionDataDir()}`,
      "",
      "See docs/nutrition-data.md.",
    ].join("\n"),
  );
  process.exit(1);
}

const adapter = getAdapter(sourceCode);

if (!adapter) {
  console.error(
    [
      `No adapter for source "${sourceCode}".`,
      "",
      `Available: ${availableAdapters().join(", ") || "(none)"}`,
      "",
      "An adapter is written only after a real file has been inspected —",
      "guessing a dataset's columns would risk importing wrong nutrition.",
    ].join("\n"),
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  if (!adapter || !version || !file) return;

  /*
   * `file` may name a subdirectory (indb/…), so separators are allowed here —
   * unlike a manifest's `file`, which must be a plain name. Containment is
   * still enforced: resolveDatasetFile refuses anything outside the data
   * directory.
   */
  const path = resolveDatasetFile(file);

  let parsed: ParsedFile;
  let checksum: string;

  try {
    const extension = extname(path).toLowerCase();
    const bytes = readFileSync(path);
    // Checksum the bytes on disk, so two runs over the same file are provably
    // over the same file regardless of how it was parsed.
    checksum = createHash("sha256").update(bytes).digest("hex");

    parsed =
      extension === ".xlsx" || extension === ".xlsm"
        ? await readXlsx(path, sheet)
        : parseCsv(bytes.toString("utf8"));
  } catch (error) {
    console.error(
      [
        `Cannot read "${file}".`,
        "",
        `Expected it under: ${nutritionDataDir()}`,
        "",
        "That directory is git-ignored and starts empty — the datasets are not",
        "ours to commit. See data/nutrition/README.md.",
        "",
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const result = await runAdapterImport({
    prisma,
    adapter,
    headers: parsed.headers,
    rows: parsed.rows,
    version,
    fileName: displayFileName(path),
    checksum,
    dryRun,
  });

  console.log(
    formatImportReport({
      sourceCode: adapter.sourceCode,
      sourceName: result.sourceName,
      version,
      fileName: displayFileName(path),
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

  // A partial import is a real outcome, not a success. CI must be able to tell.
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
