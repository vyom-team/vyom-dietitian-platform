import type { FoodCategory, FoodType } from "@/generated/prisma/enums";
import { DECIMAL_LITERAL, type DatasetManifest } from "@/validations/nutrition";

import type {
  Diagnostic,
  NormalizeResult,
  NormalizedAlias,
  NormalizedNutrientValue,
  RawRow,
} from "./types";

/**
 * Normalization and validation.
 *
 * Turns an untrusted row of strings into Vyom's own model, or explains exactly
 * why it could not. The two jobs live together because every validation here is
 * a decision *about a conversion* — "is this cell a number", "is this category
 * one we know" — and separating them would mean walking the same columns twice
 * to say the same things.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 *     MISSING IS NOT ZERO.
 *
 * A blank cell produces no nutrient value at all. It never becomes 0, and it is
 * counted separately so the report can say how much the source left unmeasured.
 * The distinction is clinical, not pedantic: "we do not know the iron content"
 * and "this food contains no iron" lead a dietitian to different decisions, and
 * once a blank has been written as a zero the difference is unrecoverable.
 */

/** NUMERIC(14,6): eight digits before the point, six after. */
const MAX_INTEGER_DIGITS = 8;
const MAX_DECIMAL_PLACES = 6;

/**
 * Checks the file actually has the columns the manifest names.
 *
 * Run once against the header, before any row is processed. A misspelled
 * column would otherwise read as blank in every row and be reported as tens of
 * thousands of missing values — technically true, and useless.
 */
export function validateHeaders(
  headers: readonly string[],
  manifest: DatasetManifest,
): Diagnostic[] {
  const present = new Set(headers);
  const diagnostics: Diagnostic[] = [];

  const require = (column: string | undefined, role: string) => {
    if (!column || present.has(column)) return;
    diagnostics.push({
      severity: "error",
      code: "MISSING_COLUMN",
      row: 0,
      column,
      message: `The file has no column "${column}" (declared as ${role}).`,
    });
  };

  require(manifest.identifierColumn, "identifierColumn");
  require(manifest.nameColumn, "nameColumn");
  require(manifest.descriptionColumn, "descriptionColumn");
  require(manifest.categoryColumn, "categoryColumn");
  require(manifest.foodTypeColumn, "foodTypeColumn");

  for (const alias of manifest.aliasColumns) require(alias.column, "aliasColumn");
  for (const nutrient of manifest.nutrients) {
    require(nutrient.column, `nutrient ${nutrient.nutrient}`);
  }

  return diagnostics;
}

/** Normalizes one row. `row` is 1-based and excludes the header. */
export function normalizeRow(
  raw: RawRow,
  manifest: DatasetManifest,
  row: number,
): NormalizeResult {
  const diagnostics: Diagnostic[] = [];
  const missing = new Set(manifest.missingValues);

  const cell = (column: string | undefined): string => {
    if (!column) return "";
    return (raw[column] ?? "").trim();
  };

  const externalId = cell(manifest.identifierColumn);
  const externalName = cell(manifest.nameColumn);

  /*
   * Both are structural. Without an identifier the record cannot be matched on
   * a re-import, which breaks idempotency; without a name it cannot be shown to
   * anyone. Either one absent means the row is not a food record.
   */
  if (externalId === "") {
    diagnostics.push({
      severity: "error",
      code: "MISSING_IDENTIFIER",
      row,
      column: manifest.identifierColumn,
      message: "Row has no source identifier, so it could not be imported idempotently.",
    });
  }

  if (externalName === "") {
    diagnostics.push({
      severity: "error",
      code: "MISSING_NAME",
      row,
      ...(externalId ? { externalId } : {}),
      column: manifest.nameColumn,
      message: "Row has no food name.",
    });
  }

  if (externalId === "" || externalName === "") {
    return { record: null, diagnostics };
  }

  const { category, externalCategory } = resolveCategory(
    cell(manifest.categoryColumn),
    manifest,
    row,
    externalId,
    diagnostics,
  );

  const foodType = resolveFoodType(
    cell(manifest.foodTypeColumn),
    manifest,
    row,
    externalId,
    diagnostics,
  );

  const aliases = resolveAliases(raw, manifest, externalName);

  const nutrients = resolveNutrients(
    raw,
    manifest,
    missing,
    row,
    externalId,
    diagnostics,
  );

  if (nutrients.length === 0) {
    /*
     * A warning, not an error. A food with no measured values is a real thing
     * in a dataset, and importing it as a name with honest gaps is better than
     * discarding it — but it is worth knowing how often it happens, because a
     * whole file of them means the nutrient mapping is wrong.
     */
    diagnostics.push({
      severity: "warning",
      code: "NO_NUTRIENT_VALUES",
      row,
      externalId,
      message:
        "No nutrient value could be read for this record. It will import with no measured values — not with zeros.",
    });
  }

  const description = cell(manifest.descriptionColumn);

  return {
    record: {
      externalId,
      externalName,
      externalCategory,
      // Canonical name starts as the published name. Curation — merging
      // regional variants, choosing a house style — is a human task, and this
      // phase deliberately does not guess at it.
      canonicalName: externalName,
      description: description === "" ? null : description,
      category,
      foodType,
      aliases,
      nutrients,
      raw,
      row,
    },
    diagnostics,
  };
}

function resolveCategory(
  published: string,
  manifest: DatasetManifest,
  row: number,
  externalId: string,
  diagnostics: Diagnostic[],
): { category: FoodCategory; externalCategory: string | null } {
  if (published === "") {
    return { category: manifest.defaultCategory, externalCategory: null };
  }

  const mapped = manifest.categoryMap[published];
  if (mapped) return { category: mapped, externalCategory: published };

  /*
   * Falls back rather than failing: a category is presentational, and losing a
   * whole food over an unmapped group would be a poor trade. The warning is
   * what makes the gap visible, and the publisher's wording is kept on the
   * source_food row so the mapping can be completed and the import re-run.
   */
  diagnostics.push({
    severity: "warning",
    code: "UNMAPPED_CATEGORY",
    row,
    externalId,
    column: manifest.categoryColumn ?? "",
    message: `Category "${published}" is not in the manifest's categoryMap; using ${manifest.defaultCategory}.`,
  });

  return { category: manifest.defaultCategory, externalCategory: published };
}

function resolveFoodType(
  published: string,
  manifest: DatasetManifest,
  row: number,
  externalId: string,
  diagnostics: Diagnostic[],
): FoodType {
  if (published === "") return manifest.foodType;

  const mapped = manifest.foodTypeMap[published];
  if (mapped) return mapped;

  diagnostics.push({
    severity: "warning",
    code: "UNMAPPED_FOOD_TYPE",
    row,
    externalId,
    column: manifest.foodTypeColumn ?? "",
    message: `Food type "${published}" is not in the manifest's foodTypeMap; using ${manifest.foodType}.`,
  });

  return manifest.foodType;
}

function resolveAliases(
  raw: RawRow,
  manifest: DatasetManifest,
  canonicalName: string,
): NormalizedAlias[] {
  const aliases: NormalizedAlias[] = [];
  const seen = new Set<string>([canonicalName.toLowerCase()]);

  for (const mapping of manifest.aliasColumns) {
    const value = (raw[mapping.column] ?? "").trim();
    if (value === "") continue;

    for (const part of value.split(mapping.separator)) {
      const alias = part.trim();
      if (alias === "") continue;

      // An alias identical to the canonical name adds nothing and would fail
      // the unique index on a second import anyway.
      const key = alias.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      aliases.push({
        alias,
        languageCode: mapping.languageCode ?? null,
        region: mapping.region ?? null,
      });
    }
  }

  return aliases;
}

function resolveNutrients(
  raw: RawRow,
  manifest: DatasetManifest,
  missing: ReadonlySet<string>,
  row: number,
  externalId: string,
  diagnostics: Diagnostic[],
): NormalizedNutrientValue[] {
  const values: NormalizedNutrientValue[] = [];
  const basisQuantity = String(manifest.basis.quantity);

  for (const mapping of manifest.nutrients) {
    const cell = (raw[mapping.column] ?? "").trim();

    /*
     * THE MISSING CASE. No value is produced, no row will be written, and the
     * absence is counted. This is the single most important branch in the
     * importer: turning this into `value: 0` would silently fabricate a
     * measurement for every gap in the source.
     */
    if (missing.has(cell)) {
      diagnostics.push({
        severity: "warning",
        code: "MISSING_NUTRIENT_VALUE",
        row,
        externalId,
        column: mapping.column,
        message: `${mapping.nutrient}: the source published no value. Recorded as absent, not zero.`,
      });
      continue;
    }

    if (!DECIMAL_LITERAL.test(cell)) {
      /*
       * Not on the missing list and not a number. Reported rather than skipped:
       * an unrecognised marker usually means the manifest's missingValues is
       * incomplete, and dropping it quietly would hide that.
       */
      diagnostics.push({
        severity: "error",
        code: "INVALID_NUMBER",
        row,
        externalId,
        column: mapping.column,
        message:
          `${mapping.nutrient}: "${cell}" is not a number. ` +
          "If it marks an unmeasured value, add it to the manifest's missingValues.",
      });
      continue;
    }

    if (cell.startsWith("-")) {
      diagnostics.push({
        severity: "error",
        code: "NEGATIVE_VALUE",
        row,
        externalId,
        column: mapping.column,
        message: `${mapping.nutrient}: "${cell}" is negative, which is not a possible quantity.`,
      });
      continue;
    }

    const shape = describeDecimal(cell);

    if (shape.integerDigits > MAX_INTEGER_DIGITS) {
      diagnostics.push({
        severity: "error",
        code: "VALUE_OUT_OF_RANGE",
        row,
        externalId,
        column: mapping.column,
        message: `${mapping.nutrient}: "${cell}" exceeds the ${MAX_INTEGER_DIGITS} digits the column stores.`,
      });
      continue;
    }

    if (shape.decimalPlaces > MAX_DECIMAL_PLACES) {
      // Postgres would round this on write. Saying so is the difference
      // between a documented rounding and a silent one.
      diagnostics.push({
        severity: "warning",
        code: "PRECISION_LOSS",
        row,
        externalId,
        column: mapping.column,
        message: `${mapping.nutrient}: "${cell}" has more than ${MAX_DECIMAL_PLACES} decimal places and will be rounded on storage.`,
      });
    }

    values.push({
      nutrientCode: mapping.nutrient,
      // Carried as text. The published figure reaches NUMERIC without ever
      // being a JavaScript float.
      value: cell,
      unit: mapping.unit,
      basisQuantity,
      basisUnitCode: manifest.basis.unit,
      sourceNutrientCode: mapping.sourceNutrientCode ?? null,
    });
  }

  return values;
}

/**
 * Digit counts of a decimal literal, without converting it to a number.
 *
 * Exponent notation is not analysed: it is rare in published food tables, and
 * guessing at its expanded shape would be less honest than declining to check.
 */
function describeDecimal(literal: string): {
  integerDigits: number;
  decimalPlaces: number;
} {
  if (/[eE]/.test(literal)) return { integerDigits: 0, decimalPlaces: 0 };

  const unsigned = literal.replace(/^[+-]/, "");
  const [whole = "", fraction = ""] = unsigned.split(".");

  return {
    // Leading zeros are not significant digits and must not count towards the
    // column's capacity.
    integerDigits: whole.replace(/^0+/, "").length,
    decimalPlaces: fraction.length,
  };
}
