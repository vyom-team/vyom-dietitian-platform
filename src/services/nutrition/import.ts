import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { DatasetImportStatus } from "@/generated/prisma/enums";
import { parseCsv } from "@/lib/nutrition/ingest/csv";
import { normalizeRow, validateHeaders } from "@/lib/nutrition/ingest/normalize";
import { diagnosticsForStorage } from "@/lib/nutrition/ingest/report";
import {
  emptyStatistics,
  type Diagnostic,
  type ImportStatistics,
  type NormalizedFood,
} from "@/lib/nutrition/ingest/types";
import type { DatasetManifest } from "@/validations/nutrition";

import { ensureSourceVersion } from "./registry";

/**
 * Dataset ingestion.
 *
 * The stage that turns validated records into rows:
 *
 *     RAW → PARSE → NORMALIZE → VALIDATE → MAP → **IMPORT** → DATABASE
 *
 * IDEMPOTENCE
 *
 * Running the same import twice produces the same database, not two copies.
 * Every write is keyed on something stable that the publisher supplies:
 *
 *     food           (source version, publisher's food id)
 *     nutrient value (food, nutrient, source version)
 *     alias          (food, alias text)
 *     source food    (source version, publisher's food id)
 *
 * Nothing is deduplicated by deleting. A re-run matches and updates.
 *
 * FAILURE SAFETY
 *
 * Records are written in batches, each in its own transaction. One enormous
 * transaction across a large dataset would hold locks for the whole run and
 * lose everything to a single bad row; per-batch transactions mean a failure
 * leaves whole records committed and whole records absent, never half a food.
 * The manifest records what happened, and because the import is idempotent the
 * fix is simply to run it again.
 *
 * Takes a PrismaClient rather than importing one, so the same code path serves
 * the CLI and the tests.
 */

const BATCH_SIZE = 200;

export type ImportOptions = {
  prisma: PrismaClient;
  manifest: DatasetManifest;
  /** File contents, already read. Reading from disk belongs to the caller. */
  contents: string;
  /** File name only — never a path. Stored on the manifest row. */
  fileName: string;
  /** Report what would happen and write nothing but the manifest row. */
  dryRun?: boolean;
};

export type ImportResult = {
  importId: string;
  status: DatasetImportStatus;
  sourceName: string;
  checksum: string;
  statistics: ImportStatistics;
  diagnostics: Diagnostic[];
  startedAt: Date;
  completedAt: Date;
};

export async function runDatasetImport(options: ImportOptions): Promise<ImportResult> {
  const { prisma, manifest, contents, fileName } = options;
  const dryRun = options.dryRun ?? false;
  const startedAt = new Date();

  const checksum = createHash("sha256").update(contents, "utf8").digest("hex");

  const version = await ensureSourceVersion(prisma, manifest.source, manifest.version);

  /*
   * The manifest row is written before any work starts. A run that crashes
   * mid-way then leaves a RUNNING row rather than no evidence at all, which is
   * the difference between "an import failed here" and silence.
   */
  const importRecord = await prisma.datasetImport.create({
    data: {
      sourceVersionId: version.id,
      status: "RUNNING",
      inputFile: fileName,
      inputChecksum: checksum,
      dryRun,
    },
    select: { id: true },
  });

  const statistics = emptyStatistics();
  const diagnostics: Diagnostic[] = [];

  try {
    const parsed = parseCsv(contents, manifest.delimiter);

    const headerDiagnostics = validateHeaders(parsed.headers, manifest);
    diagnostics.push(...headerDiagnostics);

    if (headerDiagnostics.some((d) => d.severity === "error")) {
      /*
       * A missing column is a manifest error, not a data error. Continuing
       * would report every row as missing values and write a dataset full of
       * gaps, so the run stops before touching anything.
       */
      const completedAt = new Date();
      await finalise(prisma, importRecord.id, "FAILED", statistics, diagnostics, completedAt);
      return {
        importId: importRecord.id,
        status: "FAILED",
        sourceName: version.sourceName,
        checksum,
        statistics,
        diagnostics,
        startedAt,
        completedAt,
      };
    }

    const nutrientIds = await loadNutrientIds(prisma);
    const records: NormalizedFood[] = [];
    const seenIdentifiers = new Set<string>();

    for (const [index, raw] of parsed.rows.entries()) {
      statistics.recordsRead += 1;
      const { record, diagnostics: rowDiagnostics } = normalizeRow(
        raw,
        manifest,
        index + 1,
      );
      diagnostics.push(...rowDiagnostics);

      statistics.nutrientValuesMissing += rowDiagnostics.filter(
        (d) => d.code === "MISSING_NUTRIENT_VALUE",
      ).length;
      statistics.nutrientValuesInvalid += rowDiagnostics.filter(
        (d) => d.code === "INVALID_NUMBER" || d.code === "NEGATIVE_VALUE" || d.code === "VALUE_OUT_OF_RANGE",
      ).length;

      if (!record) {
        statistics.recordsInvalid += 1;
        continue;
      }

      /*
       * The same identifier twice in one file. Both rows cannot be the same
       * food, and nothing here can tell which is authoritative — so the first
       * is kept, the second is skipped, and it is reported. Silently letting
       * the second overwrite the first would make the import order-dependent.
       */
      if (seenIdentifiers.has(record.externalId)) {
        statistics.duplicateIdentifiers += 1;
        statistics.recordsSkipped += 1;
        diagnostics.push({
          severity: "error",
          code: "DUPLICATE_IDENTIFIER",
          row: record.row,
          externalId: record.externalId,
          message:
            `Identifier "${record.externalId}" already appeared in this file. ` +
            "The later row was skipped; the two records must be reconciled at source.",
        });
        continue;
      }

      seenIdentifiers.add(record.externalId);
      statistics.recordsValid += 1;
      records.push(record);
    }

    if (!dryRun) {
      for (let start = 0; start < records.length; start += BATCH_SIZE) {
        const batch = records.slice(start, start + BATCH_SIZE);
        await prisma.$transaction(async (tx) => {
          for (const record of batch) {
            await writeRecord(tx, record, version.id, nutrientIds, statistics);
          }
        });
      }

      await prisma.nutritionSourceVersion.update({
        where: { id: version.id },
        data: { importedAt: new Date() },
      });
    } else {
      // A dry run reports what a real one would do. The counts it cannot know
      // without writing — created versus matched — stay at zero rather than
      // being guessed.
      statistics.recordsImported = records.length;
      statistics.mappingsMapped = records.length;
    }

    const hasErrors = diagnostics.some((d) => d.severity === "error");
    const status: DatasetImportStatus =
      statistics.recordsValid === 0 && statistics.recordsRead > 0
        ? "FAILED"
        : hasErrors
          ? "PARTIAL"
          : "COMPLETED";

    const completedAt = new Date();
    await finalise(prisma, importRecord.id, status, statistics, diagnostics, completedAt);

    return {
      importId: importRecord.id,
      status,
      sourceName: version.sourceName,
      checksum,
      statistics,
      diagnostics,
      startedAt,
      completedAt,
    };
  } catch (error) {
    /*
     * Whatever went wrong, the manifest must not be left claiming RUNNING. The
     * message is recorded so a retry starts from a diagnosis rather than a
     * guess.
     */
    const completedAt = new Date();
    diagnostics.push({
      severity: "error",
      code: "INVALID_NUMBER",
      row: 0,
      message: `Import aborted: ${error instanceof Error ? error.message : String(error)}`,
    });
    await finalise(prisma, importRecord.id, "FAILED", statistics, diagnostics, completedAt);
    throw error;
  }
}

/** Prisma transaction client — the subset available inside `$transaction`. */
type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function writeRecord(
  tx: TransactionClient,
  record: NormalizedFood,
  sourceVersionId: string,
  nutrientIds: ReadonlyMap<string, string>,
  statistics: ImportStatistics,
): Promise<void> {
  /*
   * findFirst then create/update rather than upsert: the food's unique key
   * spans two nullable columns, and Prisma will not accept a compound unique
   * lookup containing nullables. The database still enforces the key.
   */
  const existing = await tx.food.findFirst({
    where: {
      originSourceVersionId: sourceVersionId,
      originSourceFoodId: record.externalId,
    },
    select: { id: true },
  });

  let foodId: string;

  if (existing) {
    await tx.food.update({
      where: { id: existing.id },
      data: {
        canonicalName: record.canonicalName,
        description: record.description,
        category: record.category,
        foodType: record.foodType,
      },
    });
    foodId = existing.id;
    statistics.foodsUpdated += 1;
  } else {
    const created = await tx.food.create({
      data: {
        canonicalName: record.canonicalName,
        description: record.description,
        category: record.category,
        foodType: record.foodType,
        originSourceVersionId: sourceVersionId,
        originSourceFoodId: record.externalId,
      },
      select: { id: true },
    });
    foodId = created.id;
    statistics.foodsCreated += 1;
  }

  for (const alias of record.aliases) {
    await tx.foodAlias.upsert({
      where: { foodId_alias: { foodId, alias: alias.alias } },
      create: {
        foodId,
        alias: alias.alias,
        languageCode: alias.languageCode,
        region: alias.region,
      },
      update: { languageCode: alias.languageCode, region: alias.region },
    });
    statistics.aliasesWritten += 1;
  }

  for (const value of record.nutrients) {
    const nutrientId = nutrientIds.get(value.nutrientCode);
    // The manifest schema already rejects unknown nutrient codes, so this can
    // only mean the registry has not been synced. Skipping is safer than
    // inventing a dictionary entry mid-import.
    if (!nutrientId) continue;

    await tx.foodNutrient.upsert({
      where: {
        foodId_nutrientId_sourceVersionId: { foodId, nutrientId, sourceVersionId },
      },
      create: {
        foodId,
        nutrientId,
        sourceVersionId,
        value: value.value,
        unit: value.unit,
        basisQuantity: value.basisQuantity,
        basisUnitCode: value.basisUnitCode,
        sourceNutrientCode: value.sourceNutrientCode,
      },
      update: {
        value: value.value,
        unit: value.unit,
        basisQuantity: value.basisQuantity,
        basisUnitCode: value.basisUnitCode,
        sourceNutrientCode: value.sourceNutrientCode,
      },
    });
    statistics.nutrientValuesWritten += 1;
  }

  /*
   * The staging record: what the file said, and what it was tied to. Written
   * after the food so the mapping is never recorded as MAPPED before the food
   * it points at exists.
   */
  await tx.sourceFood.upsert({
    where: { sourceVersionId_externalId: { sourceVersionId, externalId: record.externalId } },
    create: {
      sourceVersionId,
      externalId: record.externalId,
      externalName: record.externalName,
      externalCategory: record.externalCategory,
      foodId,
      mappingStatus: "MAPPED",
      // 1 exactly: the match is on the publisher's own identifier, which is
      // certainty rather than similarity. Nothing here matches on names.
      confidence: "1",
      rawPayload: record.raw,
    },
    update: {
      externalName: record.externalName,
      externalCategory: record.externalCategory,
      foodId,
      mappingStatus: "MAPPED",
      confidence: "1",
      rawPayload: record.raw,
    },
  });

  statistics.mappingsMapped += 1;
  statistics.recordsImported += 1;
}

async function loadNutrientIds(
  prisma: PrismaClient,
): Promise<ReadonlyMap<string, string>> {
  const nutrients = await prisma.nutrient.findMany({ select: { id: true, code: true } });
  return new Map(nutrients.map((nutrient) => [nutrient.code, nutrient.id]));
}

async function finalise(
  prisma: PrismaClient,
  importId: string,
  status: DatasetImportStatus,
  statistics: ImportStatistics,
  diagnostics: readonly Diagnostic[],
  completedAt: Date,
): Promise<void> {
  const errors = diagnosticsForStorage(diagnostics, "error");
  const warnings = diagnosticsForStorage(diagnostics, "warning");

  await prisma.datasetImport.update({
    where: { id: importId },
    data: {
      status,
      completedAt,
      recordsRead: statistics.recordsRead,
      recordsImported: statistics.recordsImported,
      recordsSkipped: statistics.recordsSkipped,
      recordsFailed: statistics.recordsInvalid,
      errors: { total: errors.total, sample: errors.sample },
      warnings: { total: warnings.total, sample: warnings.sample },
      metadata: { statistics },
    },
  });
}
