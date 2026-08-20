import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { parseCsv } from "@/lib/nutrition/ingest/csv";
import {
  validateReferenceRow,
  type ParsedReferenceRow,
  type ReferenceManifest,
  PHYSIOLOGICAL_STATES,
  REFERENCE_RULE_TYPES,
  REFERENCE_UNITS,
  REFERENCE_VALUE_TYPES,
  SEX_APPLICABILITIES,
} from "@/validations/nutrition-reference";

/**
 * Reference-value ingestion.
 *
 * The route by which a published requirement table becomes `reference_rules`,
 * and therefore the route by which Phase 8D's targets stop reporting
 * REFERENCE_REQUIRED.
 *
 * WHAT THIS REFUSES TO DO
 *
 * It converts no unit, fills no gap, and infers no applicability. A row whose
 * unit disagrees with the nutrient dictionary is rejected rather than scaled;
 * a row with no unit is rejected rather than assumed. These are clinical
 * figures, and a plausible-looking wrong one is worse than a missing one.
 *
 * It also cannot mark a source as licensed. `permissionStatus` is a human legal
 * determination recorded deliberately — see docs/nutrition-data.md.
 *
 * Takes a PrismaClient rather than importing one, so the same code path serves
 * the CLI and the tests.
 */

export type ReferenceImportRowError = {
  /** 1-based line in the data file, counting the header. */
  line: number;
  messages: string[];
};

export type ReferenceImportResult = {
  sourceCode: string;
  version: string;
  /** Rows read from the file, excluding the header. */
  read: number;
  created: number;
  updated: number;
  /** Rows rejected. None of them was written. */
  failed: number;
  errors: ReferenceImportRowError[];
  /** True when nothing was written because --dry-run was set. */
  dryRun: boolean;
  /** Rule types seen, with counts, for the report. */
  byRuleType: { ruleType: string; count: number }[];
};

export type ReferenceImportOptions = {
  prisma: PrismaClient;
  manifest: ReferenceManifest;
  /** The file's contents. Read by the caller so this stays free of file I/O. */
  fileContents: string;
  dryRun?: boolean;
};

/**
 * Imports one reference table.
 *
 * Safe to run repeatedly: every write is keyed on the rule's own applicability,
 * so a second run updates what the first created rather than duplicating it.
 * The unique index behind that uses NULLS NOT DISTINCT, which is what makes it
 * work for rules with unbounded ages or no rule key.
 *
 * **All-or-nothing per run.** If any row fails validation, nothing is written.
 * A half-imported requirement table is worse than none: the targets it produces
 * would be silently incomplete rather than visibly absent.
 */
export async function runReferenceImport(
  options: ReferenceImportOptions,
): Promise<ReferenceImportResult> {
  const { prisma, manifest, fileContents, dryRun = false } = options;

  const parsed = parseCsv(fileContents, manifest.delimiter);
  const missing = new Set(manifest.missingValues);

  const cell = (row: Record<string, string>, column: string | undefined): string | null => {
    if (!column) return null;
    const raw = (row[column] ?? "").trim();
    return missing.has(raw) ? null : raw || null;
  };

  const rows: ParsedReferenceRow[] = [];
  const errors: ReferenceImportRowError[] = [];

  parsed.rows.forEach((raw, index) => {
    // +2: one for the header, one to make it 1-based like an editor shows.
    const line = index + 2;
    const problems: string[] = [];

    const ruleTypeRaw =
      cell(raw, manifest.columns.ruleType) ?? manifest.defaults.ruleType ?? null;
    const valueTypeRaw =
      cell(raw, manifest.columns.valueType) ?? manifest.defaults.valueType ?? null;
    const unitRaw = cell(raw, manifest.columns.unit) ?? manifest.defaults.unit ?? null;
    const sexRaw = cell(raw, manifest.columns.sex) ?? manifest.defaults.sex;
    const stateRaw =
      cell(raw, manifest.columns.physiologicalState) ??
      manifest.defaults.physiologicalState;

    const ruleType = pick(ruleTypeRaw, REFERENCE_RULE_TYPES);
    const valueType = pick(valueTypeRaw, REFERENCE_VALUE_TYPES);
    const unit = pick(unitRaw, REFERENCE_UNITS);
    const sex = pick(sexRaw, SEX_APPLICABILITIES);
    const state = pick(stateRaw, PHYSIOLOGICAL_STATES);

    if (!ruleType) problems.push(`Unknown rule type "${ruleTypeRaw ?? ""}".`);
    if (!valueType) problems.push(`Unknown value type "${valueTypeRaw ?? ""}".`);
    if (!unit) problems.push(`Unknown unit "${unitRaw ?? ""}".`);
    if (!sex) problems.push(`Unknown sex "${sexRaw}".`);
    if (!state) problems.push(`Unknown physiological state "${stateRaw}".`);

    if (!ruleType || !valueType || !unit || !sex || !state) {
      errors.push({ line, messages: problems });
      return;
    }

    const row: ParsedReferenceRow = {
      ruleType,
      nutrientCode: cell(raw, manifest.columns.nutrient),
      ruleKey: cell(raw, manifest.columns.ruleKey),
      sexApplicability: sex,
      ageMinYears: parseAge(cell(raw, manifest.columns.ageMin)),
      ageMaxYears: parseAge(cell(raw, manifest.columns.ageMax)),
      physiologicalState: state,
      valueType,
      value: cell(raw, manifest.columns.value),
      valueMin: cell(raw, manifest.columns.valueMin),
      valueMax: cell(raw, manifest.columns.valueMax),
      unit,
      notes: cell(raw, manifest.columns.notes),
    };

    const rowErrors = validateReferenceRow(row);

    if (rowErrors.length > 0) {
      errors.push({ line, messages: rowErrors });
      return;
    }

    rows.push(row);
  });

  const byRuleType = countByRuleType(rows);

  const base: ReferenceImportResult = {
    sourceCode: manifest.source,
    version: manifest.version,
    read: parsed.rows.length,
    created: 0,
    updated: 0,
    failed: errors.length,
    errors,
    dryRun,
    byRuleType,
  };

  /*
   * Nothing is written if any row failed. See the all-or-nothing note above:
   * a partially imported requirement table produces targets that look complete
   * and are not.
   */
  if (errors.length > 0 || dryRun) return base;

  const version = await resolveSourceVersion(prisma, manifest);
  const nutrientIds = await loadNutrientIds(prisma, rows);

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const where = {
      sourceVersionId: version.id,
      ruleType: row.ruleType,
      ruleKey: row.ruleKey,
      nutrientId: row.nutrientCode ? (nutrientIds.get(row.nutrientCode) ?? null) : null,
      sexApplicability: row.sexApplicability,
      ageMinYears: row.ageMinYears,
      ageMaxYears: row.ageMaxYears,
      physiologicalState: row.physiologicalState,
    };

    const data = {
      valueType: row.valueType,
      value: row.value,
      valueMin: row.valueMin,
      valueMax: row.valueMax,
      unit: row.unit,
      // The manifest's citation travels onto every rule, so a reviewer can find
      // the printed table a figure came from without the manifest in hand.
      notes: [row.notes, manifest.citation].filter(Boolean).join(" — "),
      isActive: true,
    };

    const existing = await prisma.referenceRule.findFirst({
      where,
      select: { id: true },
    });

    if (existing) {
      await prisma.referenceRule.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.referenceRule.create({ data: { ...where, ...data } });
      created += 1;
    }
  }

  await prisma.nutritionSourceVersion.update({
    where: { id: version.id },
    data: { importedAt: new Date() },
  });

  return { ...base, created, updated };
}

// ---------------------------------------------------------------------------

/**
 * Narrows a cell to one of a fixed vocabulary, or null.
 *
 * Returns the value rather than acting as a type guard, so the narrowing
 * survives the deferred error check below — a guard inside an `if` that only
 * pushes a message cannot tell the compiler anything later on.
 */
function pick<T extends readonly string[]>(
  value: string | null,
  allowed: T,
): T[number] | null {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : null;
}

function parseAge(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
}

function countByRuleType(
  rows: readonly ParsedReferenceRow[],
): { ruleType: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.ruleType, (counts.get(row.ruleType) ?? 0) + 1);

  return [...counts.entries()]
    .map(([ruleType, count]) => ({ ruleType, count }))
    .sort((a, b) => a.ruleType.localeCompare(b.ruleType));
}

/**
 * Finds or creates the release these values belong to.
 *
 * The source itself must already be registered — registering one is a
 * deliberate act that records what would have to be licensed, and an importer
 * inventing sources would undo that.
 */
async function resolveSourceVersion(prisma: PrismaClient, manifest: ReferenceManifest) {
  const source = await prisma.nutritionSource.findUnique({
    where: { code: manifest.source },
    select: { id: true },
  });

  if (!source) {
    throw new Error(
      `Source ${manifest.source} is not registered. Run npm run nutrition:registry first.`,
    );
  }

  const existing = await prisma.nutritionSourceVersion.findFirst({
    where: { sourceId: source.id, version: manifest.version },
    select: { id: true },
  });

  if (existing) return existing;

  return prisma.nutritionSourceVersion.create({
    data: { sourceId: source.id, version: manifest.version },
    select: { id: true },
  });
}

async function loadNutrientIds(
  prisma: PrismaClient,
  rows: readonly ParsedReferenceRow[],
): Promise<Map<string, string>> {
  const codes = [...new Set(rows.map((row) => row.nutrientCode).filter(Boolean))] as string[];
  if (codes.length === 0) return new Map();

  const nutrients = await prisma.nutrient.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });

  return new Map(nutrients.map((nutrient) => [nutrient.code, nutrient.id]));
}

/** Human-readable summary for the CLI. */
export function formatReferenceImportReport(result: ReferenceImportResult): string {
  const lines: string[] = [
    "",
    `Reference import — ${result.sourceCode} ${result.version}`,
    "=".repeat(48),
    `  rows read       ${String(result.read).padStart(8)}`,
    `  created         ${String(result.created).padStart(8)}`,
    `  updated         ${String(result.updated).padStart(8)}`,
    `  failed          ${String(result.failed).padStart(8)}`,
  ];

  if (result.byRuleType.length > 0) {
    lines.push("", "  By rule type");
    for (const entry of result.byRuleType) {
      lines.push(`    ${entry.ruleType.padEnd(30)} ${String(entry.count).padStart(6)}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push(
      "",
      "  NOTHING WAS WRITTEN. Every row must be valid before a clinical",
      "  reference table is imported — a partial import produces targets",
      "  that look complete and are not.",
      "",
    );

    for (const error of result.errors.slice(0, 40)) {
      lines.push(`  line ${error.line}`);
      for (const message of error.messages) lines.push(`    - ${message}`);
    }

    if (result.errors.length > 40) {
      lines.push(`  … and ${result.errors.length - 40} more rows with problems`);
    }
  }

  if (result.dryRun) {
    lines.push("", "  Dry run — nothing was written.");
  }

  lines.push(
    "",
    "  Licensing is unchanged. Importing values does not clear a source for",
    "  commercial use; that is a human determination recorded against the",
    "  source. See docs/nutrition-data.md.",
    "",
  );

  return lines.join("\n");
}
