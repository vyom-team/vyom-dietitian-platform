import type { NormalizedFood, RawRow } from "../ingest/types";
import type { Diagnostic } from "../ingest/types";

/**
 * The source adapter contract.
 *
 * Every dataset publishes a different shape: different column names, different
 * category vocabularies, different ways of saying "we did not measure this".
 * An adapter is the one place that knows about a particular publisher, and its
 * job is to turn that shape into Vyom's.
 *
 *     IFCT rows  ─┐
 *     INDB rows  ─┼─► adapter ─► NormalizedFood[] ─► validate ─► database
 *     USDA rows  ─┘
 *
 * WHY THIS EXISTS
 *
 * Phase 8A drove ingestion from a JSON manifest, which works when a dataset is
 * one flat table of nutrient columns. Real datasets are not that. INDB carries
 * every nutrient twice — per 100 g and per serving — and the serving weight is
 * implied rather than stated. Expressing that in a manifest would mean
 * inventing manifest syntax for one publisher's quirk, and the next publisher
 * would need another.
 *
 * So source-specific logic lives in an adapter, and everything downstream —
 * validation, provenance, idempotence, reporting — stays identical for all of
 * them. The manifest route still exists for datasets that genuinely are one
 * flat table.
 *
 * Adapters are **pure**: rows in, records out. They do not read files, touch
 * the database, or log. That is what makes them testable against a handful of
 * fixture rows instead of a 12 MB download.
 */

export type AdapterContext = {
  /** The release being imported, for provenance in diagnostics. */
  sourceCode: string;
  version: string;
};

/**
 * A nutrient column the adapter knows about, declared up front.
 *
 * Written to `source_nutrient_mappings` before any row is processed, so the
 * mapping a run used is recorded even if the run later fails — and so a column
 * the adapter cannot map is visible as an UNMAPPED row rather than vanishing.
 */
export type NutrientColumnMapping = {
  /** The publisher's column, verbatim. */
  sourceColumn: string;
  /** Vyom nutrient code, or null when nothing represents it yet. */
  nutrientCode: string | null;
  /** The unit as the source publishes it. */
  sourceUnit: string | null;
  notes?: string;
};

export type AdapterResult = {
  records: NormalizedFood[];
  diagnostics: Diagnostic[];
};

export interface NutritionSourceAdapter {
  /** Registered source code this adapter handles, e.g. "INDB". */
  readonly sourceCode: string;
  /** Human-readable, for reports. */
  readonly displayName: string;

  /**
   * The nutrient columns this adapter recognises, including the ones it
   * cannot map. Called before parsing so the mapping is recorded up front.
   */
  nutrientColumns(headers: readonly string[]): NutrientColumnMapping[];

  /**
   * Checks the file is the shape this adapter expects.
   *
   * Returns errors rather than throwing, and a single error here stops the run
   * before anything is written — a dataset whose columns moved is a dataset
   * nobody should import silently.
   */
  validateHeaders(headers: readonly string[]): Diagnostic[];

  /** Turns raw rows into Vyom records. Pure. */
  parse(rows: readonly RawRow[], context: AdapterContext): AdapterResult;
}
