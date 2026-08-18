import { indbAdapter } from "./indb";
import type { NutritionSourceAdapter } from "./types";

/**
 * The adapter registry.
 *
 * One adapter per source that Vyom can actually read. A source appears here
 * only when a real file has been inspected and its columns are known.
 *
 * WHY IFCT AND USDA ARE ABSENT
 *
 * Writing an adapter for a dataset nobody has opened means guessing column
 * names, nutrient meanings, and units — the exact fabrication this pipeline
 * exists to prevent. An adapter that guesses wrong fails loudly at best and
 * imports subtly wrong nutrition at worst.
 *
 *   IFCT   ICMR-NIN publishes it as a copyrighted PDF whose owner permissions
 *          deny text extraction. Vyom does not circumvent that, so there is no
 *          file to write an adapter against. See data/nutrition/README.md.
 *
 *   USDA   Bulk CSV downloads exist and are unrestricted. The adapter arrives
 *          with the download, once its schema has been inspected — not before.
 *
 * Both drop in behind this interface with no change to anything downstream.
 */

const ADAPTERS: readonly NutritionSourceAdapter[] = [indbAdapter];

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

export { indbAdapter };
export type { NutritionSourceAdapter } from "./types";
