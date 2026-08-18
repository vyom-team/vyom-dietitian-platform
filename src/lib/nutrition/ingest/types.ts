import type { FoodCategory, FoodType, NutrientUnit } from "@/generated/prisma/enums";

/**
 * The shapes that move through the ingestion pipeline.
 *
 *     RAW → PARSE → NORMALIZE → VALIDATE → MAP → IMPORT → DATABASE
 *
 * Each stage has its own type, and they are deliberately different. A raw row
 * is untrusted strings from a file; a normalized record is Vyom's own model.
 * Keeping them separate is what stops dataset column names from leaking into
 * the application — the rule from the phase brief that everything else here
 * follows.
 */

/** One row as read from the file: column name → cell, all strings, untrusted. */
export type RawRow = Readonly<Record<string, string>>;

export type ParsedFile = {
  headers: readonly string[];
  rows: readonly RawRow[];
};

/**
 * Why a diagnostic was raised.
 *
 * Machine codes rather than message matching: the report groups by these, and
 * the tests assert on them. Messages are for humans and may be reworded.
 */
export type DiagnosticCode =
  | "MISSING_COLUMN"
  | "MISSING_IDENTIFIER"
  | "MISSING_NAME"
  | "DUPLICATE_IDENTIFIER"
  | "UNMAPPED_CATEGORY"
  | "UNMAPPED_FOOD_TYPE"
  | "INVALID_NUMBER"
  | "NEGATIVE_VALUE"
  | "PRECISION_LOSS"
  | "VALUE_OUT_OF_RANGE"
  | "MISSING_NUTRIENT_VALUE"
  | "NO_NUTRIENT_VALUES"
  | "UNKNOWN_NUTRIENT";

export type Diagnostic = {
  severity: "error" | "warning";
  code: DiagnosticCode;
  /** 1-based row number in the data file, excluding the header. */
  row: number;
  /** The publisher's identifier, when the row got far enough to have one. */
  externalId?: string;
  /** Source column, where the problem is attributable to one. */
  column?: string;
  message: string;
};

/**
 * One nutrient measurement, normalized but not yet written.
 *
 * `value` is a **string**, not a number. It is carried from the file to the
 * NUMERIC column without passing through a JavaScript float, so a published
 * figure cannot be altered in transit by binary floating point.
 */
export type NormalizedNutrientValue = {
  nutrientCode: string;
  value: string;
  unit: NutrientUnit;
  basisQuantity: string;
  basisUnitCode: string;
  sourceNutrientCode: string | null;
};

/**
 * One food, normalized into Vyom's model.
 *
 * Both identities are kept: `externalId`/`externalName` are what the file said,
 * `canonicalName`/`category` are what Vyom believes. The pair is what makes an
 * import auditable after the fact.
 *
 * A record with an empty `nutrients` array is valid and imports as a food with
 * no measured values — which is honest. It is *not* a food whose nutrients are
 * all zero.
 */
export type NormalizedFood = {
  externalId: string;
  externalName: string;
  externalCategory: string | null;
  canonicalName: string;
  description: string | null;
  category: FoodCategory;
  foodType: FoodType;
  aliases: readonly NormalizedAlias[];
  nutrients: readonly NormalizedNutrientValue[];
  /** The original row, preserved for the audit trail. */
  raw: RawRow;
  row: number;
};

export type NormalizedAlias = {
  alias: string;
  languageCode: string | null;
  region: string | null;
};

/**
 * The outcome of normalizing one row.
 *
 * `record` is null when the row could not be normalized at all — no identifier,
 * no name. Diagnostics are returned either way: a row that failed still has to
 * appear in the report, because a silent drop is indistinguishable from a row
 * that was never there.
 */
export type NormalizeResult = {
  record: NormalizedFood | null;
  diagnostics: readonly Diagnostic[];
};

/**
 * Everything one ingestion run counted.
 *
 * Every field is incremented from work that actually happened. Nothing here is
 * estimated, and nothing is filled in from the size of the file.
 */
export type ImportStatistics = {
  recordsRead: number;
  recordsValid: number;
  recordsInvalid: number;
  recordsSkipped: number;
  recordsImported: number;
  duplicateIdentifiers: number;
  /** Foods created versus matched to an existing row — the idempotency signal. */
  foodsCreated: number;
  foodsUpdated: number;
  nutrientValuesWritten: number;
  /** Cells the source left blank. Recorded, never turned into zeros. */
  nutrientValuesMissing: number;
  nutrientValuesInvalid: number;
  aliasesWritten: number;
  mappingsMapped: number;
  mappingsNeedingReview: number;
};

export function emptyStatistics(): ImportStatistics {
  return {
    recordsRead: 0,
    recordsValid: 0,
    recordsInvalid: 0,
    recordsSkipped: 0,
    recordsImported: 0,
    duplicateIdentifiers: 0,
    foodsCreated: 0,
    foodsUpdated: 0,
    nutrientValuesWritten: 0,
    nutrientValuesMissing: 0,
    nutrientValuesInvalid: 0,
    aliasesWritten: 0,
    mappingsMapped: 0,
    mappingsNeedingReview: 0,
  };
}
