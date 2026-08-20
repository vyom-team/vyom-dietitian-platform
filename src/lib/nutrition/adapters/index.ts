import { ifctAdapter } from "./ifct";
import { indbAdapter } from "./indb";
import type { NutritionSourceAdapter } from "./types";

/**
 * The adapter registry.
 *
 * One adapter per source that Vyom can actually read. A source appears here
 * only when a real file has been inspected and its columns are known — writing
 * one for a dataset nobody has opened means guessing column names, nutrient
 * meanings, and units, which is the exact fabrication this pipeline exists to
 * prevent.
 *
 *   IFCT   Added once a tabular extraction of the publication was supplied and
 *          cross-verified against a second independent extraction. The book
 *          itself remains a PDF whose owner permissions deny text extraction;
 *          Vyom does not circumvent that. See the provenance record at
 *          data/nutrition/manifests/ifct-2017-tables.source.json.
 *
 *   USDA   Bulk CSV downloads exist and are unrestricted. The adapter arrives
 *          with the download, once its schema has been inspected — not before.
 */

const ADAPTERS: readonly NutritionSourceAdapter[] = [ifctAdapter, indbAdapter];

export function getAdapter(sourceCode: string): NutritionSourceAdapter | null {
  return (
    ADAPTERS.find(
      (adapter) => adapter.sourceCode.toUpperCase() === sourceCode.toUpperCase(),
    ) ?? null
  );
}

/** Source codes with a working adapter, for CLI help and error messages. */
export function availableAdapters(): string[] {
  return ADAPTERS.map((adapter) => adapter.sourceCode);
}

export { ifctAdapter, indbAdapter };
export type { NutritionSourceAdapter } from "./types";
