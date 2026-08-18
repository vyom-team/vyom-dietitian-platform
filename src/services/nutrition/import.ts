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
  type RawRow,
} from "@/lib/nutrition/ingest/types";
import type {
  NutrientColumnMapping,
  NutritionSourceAdapter,
} from "@/lib/nutrition/adapters/types";
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

const BATCH_SIZE = 100;

/**
 * Per-batch transaction budget.
 *
 * Generous because a batch does real work — a food with forty nutrients across
 * a thousand records adds up — and because the alternative to waiting is a
 * half-written batch. Prisma's 5 second default is tuned for request handling,
 * not bulk ingestion.
 */
const TRANSACTION_TIMEOUT_MS = 120_000;

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
        await prisma.$transaction(
          async (tx) => {
            for (const record of batch) {
              await writeRecord(tx, record, version.id, nutrientIds, statistics);
            }
          },
          { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_TIMEOUT_MS },
        );
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
        normalizedName: record.normalizedName,
        description: record.description,
        category: record.category,
        foodType: record.foodType,
        preparationState: record.preparationState,
      },
    });
    foodId = existing.id;
    statistics.foodsUpdated += 1;
  } else {
    const created = await tx.food.create({
      data: {
        canonicalName: record.canonicalName,
        normalizedName: record.normalizedName,
        description: record.description,
        category: record.category,
        foodType: record.foodType,
        preparationState: record.preparationState,
        originSourceVersionId: sourceVersionId,
        originSourceFoodId: record.externalId,
      },
      select: { id: true },
    });
    foodId = created.id;
    statistics.foodsCreated += 1;
  }

  /*
   * Aliases, servings, and nutrient values are REPLACED for this source
   * version rather than upserted one row at a time.
   *
   * Two reasons, and both matter. Correctness: a value the publisher removed in
   * a later release should disappear, and row-by-row upserts would leave it
   * behind forever. Practicality: a thousand records times forty nutrients is
   * forty thousand round trips, which no sensible transaction budget survives.
   *
   * This is not "solving duplicates by deleting". The delete is scoped to one
   * food and one source version, happens inside the same transaction as the
   * insert, and touches no other source. Another release's values for the same
   * food are untouched.
   */
  if (record.aliases.length > 0) {
    await tx.foodAlias.deleteMany({ where: { foodId } });
    await tx.foodAlias.createMany({
      data: record.aliases.map((alias) => ({
        foodId,
        alias: alias.alias,
        languageCode: alias.languageCode,
        region: alias.region,
      })),
    });
    statistics.aliasesWritten += record.aliases.length;
  }

  if (record.servings.length > 0) {
    await tx.foodServing.deleteMany({ where: { foodId, sourceVersionId } });
    await tx.foodServing.createMany({
      data: record.servings.map((serving) => ({
        foodId,
        sourceVersionId,
        label: serving.label,
        weightGrams: serving.weightGrams,
        weightMethod: serving.weightMethod,
        agreementSpread: serving.agreementSpread,
        isDefault: serving.isDefault,
      })),
    });
    statistics.servingsWritten += record.servings.length;
    statistics.servingsWithoutWeight += record.servings.filter(
      (serving) => serving.weightGrams === null,
    ).length;
  }

  const values = record.nutrients.flatMap((value) => {
    const nutrientId = nutrientIds.get(value.nutrientCode);
    // Validation already rejects unknown nutrient codes, so this can only mean
    // the registry has not been synced. Skipping is safer than inventing a
    // dictionary entry mid-import.
    if (!nutrientId) return [];
    return [
      {
        foodId,
        nutrientId,
        sourceVersionId,
        value: value.value,
        unit: value.unit,
        basisQuantity: value.basisQuantity,
        basisUnitCode: value.basisUnitCode,
        sourceNutrientCode: value.sourceNutrientCode,
      },
    ];
  });

  if (values.length > 0) {
    await tx.foodNutrient.deleteMany({ where: { foodId, sourceVersionId } });
    await tx.foodNutrient.createMany({ data: values });
    statistics.nutrientValuesWritten += values.length;
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
      // The tie is the publisher's own identifier: certainty, not similarity.
      // Nothing in this pipeline matches foods on names.
      mappingMethod: "EXACT_SOURCE_ID",
      confidence: "1",
      rawPayload: record.raw,
    },
    update: {
      externalName: record.externalName,
      externalCategory: record.externalCategory,
      foodId,
      mappingStatus: "MAPPED",
      mappingMethod: "EXACT_SOURCE_ID",
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

// ---------------------------------------------------------------------------
// Adapter-driven import
// ---------------------------------------------------------------------------

/**
 * Imports a dataset through its source adapter.
 *
 * The manifest route above serves datasets that genuinely are one flat table of
 * nutrient columns. Real publishers often are not: INDB carries every nutrient
 * twice and leaves its serving weights implied. Rather than growing manifest
 * syntax for each publisher's quirks, that knowledge lives in an adapter and
 * everything from here down — provenance, idempotence, batching, reporting —
 * stays identical for all of them.
 *
 * Records arrive already normalized, so this function is concerned only with
 * writing them.
 */
export async function runAdapterImport(options: {
  prisma: PrismaClient;
  adapter: NutritionSourceAdapter;
  /** Parsed rows and headers. Reading the file belongs to the caller. */
  headers: readonly string[];
  rows: readonly RawRow[];
  version: string;
  fileName: string;
  /** SHA-256 of the source file, computed by whoever read it. */
  checksum: string;
  dryRun?: boolean;
}): Promise<ImportResult> {
  const { prisma, adapter, headers, rows, fileName, checksum } = options;
  const dryRun = options.dryRun ?? false;
  const startedAt = new Date();

  const version = await ensureSourceVersion(prisma, adapter.sourceCode, options.version);

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
    const headerDiagnostics = adapter.validateHeaders(headers);
    diagnostics.push(...headerDiagnostics);

    if (headerDiagnostics.some((d) => d.severity === "error")) {
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
    const columnMappings = adapter.nutrientColumns(headers);

    /*
     * The column mapping is recorded before any row is written, so the mapping
     * a run used survives even if the run later fails — and so a column the
     * adapter cannot map appears as an UNMAPPED row rather than vanishing.
     */
    if (dryRun) {
      statistics.unmappedNutrientColumns = columnMappings.filter(
        (mapping) => mapping.nutrientCode === null,
      ).length;
    } else {
      statistics.unmappedNutrientColumns = await recordNutrientMappings(
        prisma,
        version.id,
        columnMappings,
        nutrientIds,
      );
    }

    const parsed = adapter.parse(rows, {
      sourceCode: adapter.sourceCode,
      version: options.version,
    });
    diagnostics.push(...parsed.diagnostics);

    statistics.recordsRead = rows.length;
    statistics.nutrientValuesMissing = parsed.diagnostics.filter(
      (d) => d.code === "MISSING_NUTRIENT_VALUE",
    ).length;
    statistics.nutrientValuesInvalid = parsed.diagnostics.filter(
      (d) =>
        d.code === "INVALID_NUMBER" ||
        d.code === "NEGATIVE_VALUE" ||
        d.code === "VALUE_OUT_OF_RANGE",
    ).length;
    statistics.recordsInvalid = parsed.diagnostics.filter(
      (d) => d.code === "MISSING_IDENTIFIER" || d.code === "MISSING_NAME",
    ).length;

    // Duplicate identifiers within one file: the first row wins, later ones are
    // reported and skipped, so the import is not order-dependent.
    const records: NormalizedFood[] = [];
    const seen = new Set<string>();

    for (const record of parsed.records) {
      if (seen.has(record.externalId)) {
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
      seen.add(record.externalId);
      statistics.recordsValid += 1;
      records.push(record);
    }

    if (dryRun) {
      /*
       * A dry run reports what a real one would do, so these are counted from
       * the records in hand rather than left at zero — a report that says
       * "0 values" for a run that would write 38,000 is worse than no report.
       * Only created-versus-matched stays unknown, because that genuinely
       * cannot be determined without touching the database.
       */
      statistics.recordsImported = records.length;
      statistics.mappingsMapped = records.length;
      statistics.nutrientValuesWritten = records.reduce(
        (total, record) => total + record.nutrients.length,
        0,
      );
      statistics.aliasesWritten = records.reduce(
        (total, record) => total + record.aliases.length,
        0,
      );
      statistics.servingsWritten = records.reduce(
        (total, record) => total + record.servings.length,
        0,
      );
      statistics.servingsWithoutWeight = records.reduce(
        (total, record) =>
          total + record.servings.filter((serving) => serving.weightGrams === null).length,
        0,
      );
    } else {
      for (let start = 0; start < records.length; start += BATCH_SIZE) {
        const batch = records.slice(start, start + BATCH_SIZE);
        await prisma.$transaction(
          async (tx) => {
            for (const record of batch) {
              await writeRecord(tx, record, version.id, nutrientIds, statistics);
            }
          },
          { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_TIMEOUT_MS },
        );
      }

      await prisma.nutritionSourceVersion.update({
        where: { id: version.id },
        data: { importedAt: new Date() },
      });
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

/**
 * Writes the adapter's column mapping for this release.
 *
 * An unmapped column is stored, not skipped: a nutrient the source publishes
 * and Vyom has no home for is a gap worth seeing when someone later asks why a
 * value is missing.
 *
 * @returns how many columns could not be mapped.
 */
async function recordNutrientMappings(
  prisma: PrismaClient,
  sourceVersionId: string,
  mappings: readonly NutrientColumnMapping[],
  nutrientIds: ReadonlyMap<string, string>,
): Promise<number> {
  let unmapped = 0;

  for (const mapping of mappings) {
    const nutrientId = mapping.nutrientCode
      ? (nutrientIds.get(mapping.nutrientCode) ?? null)
      : null;

    if (!nutrientId) unmapped += 1;

    await prisma.sourceNutrientMapping.upsert({
      where: {
        sourceVersionId_sourceNutrientCode: {
          sourceVersionId,
          sourceNutrientCode: mapping.sourceColumn,
        },
      },
      create: {
        sourceVersionId,
        sourceNutrientCode: mapping.sourceColumn,
        sourceUnit: mapping.sourceUnit,
        nutrientId,
        status: nutrientId ? "MAPPED" : "UNMAPPED",
        notes: mapping.notes ?? null,
      },
      update: {
        sourceUnit: mapping.sourceUnit,
        nutrientId,
        status: nutrientId ? "MAPPED" : "UNMAPPED",
        notes: mapping.notes ?? null,
      },
    });
  }

  return unmapped;
}
