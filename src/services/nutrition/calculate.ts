import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { SourcePriority } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  calculateNutrientsFromGrams,
  unavailableNutrientCodes,
} from "@/lib/nutrition/calculate/nutrients";
import { resolveEffectiveGrams } from "@/lib/nutrition/calculate/grams";
import {
  calculationError,
  type CalculationOutcome,
  type NutrientComposition,
  type NutritionCalculationResult,
} from "@/lib/nutrition/calculate/types";

/**
 * Nutrition calculation service.
 *
 * The database half of the engine: it loads a food, decides which source
 * release to read, flattens what it found into plain data, and hands that to
 * the pure functions in `lib/nutrition/calculate`. It performs no arithmetic
 * itself — that separation is what lets the maths be tested without PostgreSQL.
 *
 * ACCESS
 *
 * Reference data is global. This module takes no `organizationId` because
 * there is no per-tenant food data to scope to; every practice reads the same
 * published figures, which is correct and is the one intended cross-tenant read
 * in the product. The *caller* is responsible for authorization — pages call
 * `requireClinicalContext()` first — and RLS enforces the same boundary
 * independently for anything reaching Supabase from a browser.
 *
 * NOTHING IS PERSISTED
 *
 * A calculation is derived data, not a business record. `FoodNutrient` is the
 * stored fact; this is arithmetic over it. Writing results to a table would
 * create copies that silently go stale the moment a source version is corrected
 * or re-imported, and there is no product requirement yet that needs them. When
 * meals become real entities they will store their *inputs* — food, serving,
 * quantity — and recalculate from those.
 */

// ---------------------------------------------------------------------------
// Source selection
// ---------------------------------------------------------------------------

/**
 * Precedence when a food carries values from more than one release.
 *
 * India-first, by design: an Indian reference describes Indian foods measured
 * on Indian samples, and an international table is a fallback rather than an
 * equal. Ordering lives on the source record — `NutritionSource.priority` — so
 * it is configuration rather than a rule buried in code.
 */
const PRIORITY_ORDER: Record<SourcePriority, number> = {
  PRIMARY_INDIAN: 0,
  SECONDARY_INDIAN: 1,
  SUPPLEMENTARY_INTERNATIONAL: 2,
};

type LoadedNutrient = {
  value: { toString(): string };
  unit: NutrientComposition["unit"];
  basisQuantity: { toString(): string };
  basisUnitCode: string;
  sourceNutrientCode: string | null;
  sourceVersionId: string;
  nutrient: {
    code: string;
    name: string;
    category: NutrientComposition["category"];
    displayOrder: number;
  };
  sourceVersion: {
    id: string;
    version: string;
    source: {
      code: string;
      name: string;
      permissionStatus: string;
      attributionRequired: boolean;
      attributionText: string | null;
      priority: SourcePriority;
    };
  };
};

/**
 * Picks the single source release a calculation will read.
 *
 * ONE RELEASE PER CALCULATION. Values are never blended across datasets: if
 * IFCT and INDB disagree about a food's protein, the answer is one of those two
 * figures with its source named, never an average and never a per-nutrient
 * mixture that would leave a single result with no coherent provenance.
 *
 * The order is deterministic, which matters more than which rule wins — the
 * same food must produce the same number on every run:
 *
 *   1. the release the canonical food was derived from, if it has values
 *   2. otherwise the highest-priority source
 *   3. ties broken on the version label, descending, then on id
 *
 * Only one dataset is imported today, so nothing currently competes. The rule
 * exists so that the second one cannot arrive and quietly change every number.
 */
function selectSourceVersion(
  nutrients: readonly LoadedNutrient[],
  originSourceVersionId: string | null,
): LoadedNutrient["sourceVersion"] | null {
  const versions = new Map<string, LoadedNutrient["sourceVersion"]>();
  for (const entry of nutrients) versions.set(entry.sourceVersionId, entry.sourceVersion);

  if (versions.size === 0) return null;

  if (originSourceVersionId && versions.has(originSourceVersionId)) {
    return versions.get(originSourceVersionId) ?? null;
  }

  return [...versions.values()].sort((a, b) => {
    const byPriority =
      PRIORITY_ORDER[a.source.priority] - PRIORITY_ORDER[b.source.priority];
    if (byPriority !== 0) return byPriority;

    const byVersion = b.version.localeCompare(a.version);
    if (byVersion !== 0) return byVersion;

    return a.id.localeCompare(b.id);
  })[0]!;
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

export type CalculateFoodNutritionInput = {
  foodId: string;
  /** A decimal string from a form, or a number from a programmatic caller. */
  quantity: string | number;
  /** "GRAM" or "SERVING". Validated by the engine, never coerced. */
  unit: string;
  /** Required when unit is SERVING. */
  servingId?: string | null;
};

/**
 * Calculates the nutrition of one food at one quantity.
 *
 * Returns a typed error rather than throwing for every state a practitioner can
 * reach: an unknown food, a serving with no published weight, a food with no
 * nutrition data. Those are facts about the data, not exceptions.
 *
 * `client` defaults to the shared connection so application callers pass only
 * the input. It is injectable for the same reason `runDatasetImport` takes one:
 * a test must be able to run this exact code path against a disposable database
 * rather than the one the application is pointed at.
 */
export async function calculateFoodNutrition(
  input: CalculateFoodNutritionInput,
  client: PrismaClient = prisma,
): Promise<CalculationOutcome<NutritionCalculationResult>> {
  const food = await client.food.findFirst({
    where: { id: input.foodId, isActive: true },
    select: {
      id: true,
      canonicalName: true,
      category: true,
      foodType: true,
      preparationState: true,
      originSourceVersionId: true,
      originSourceFoodId: true,
      servings: {
        select: {
          id: true,
          foodId: true,
          label: true,
          weightGrams: true,
          weightMethod: true,
          sourceVersionId: true,
        },
      },
      nutrients: {
        select: {
          value: true,
          unit: true,
          basisQuantity: true,
          basisUnitCode: true,
          sourceNutrientCode: true,
          sourceVersionId: true,
          nutrient: {
            select: { code: true, name: true, category: true, displayOrder: true },
          },
          sourceVersion: {
            select: {
              id: true,
              version: true,
              source: {
                select: {
                  code: true,
                  name: true,
                  permissionStatus: true,
                  attributionRequired: true,
                  attributionText: true,
                  priority: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!food) {
    return calculationError(
      "FOOD_NOT_FOUND",
      "That food is not in the database.",
    );
  }

  const chosen = selectSourceVersion(food.nutrients, food.originSourceVersionId);

  if (!chosen) {
    return calculationError(
      "NUTRITION_DATA_UNAVAILABLE",
      "No nutrition values have been published for this food.",
    );
  }

  /*
   * Composition is filtered to the chosen release before anything is
   * calculated. This is what makes "one release per calculation" true rather
   * than merely intended.
   */
  const composition: NutrientComposition[] = food.nutrients
    .filter((entry) => entry.sourceVersionId === chosen.id)
    .map((entry) => ({
      code: entry.nutrient.code,
      name: entry.nutrient.name,
      category: entry.nutrient.category,
      unit: entry.unit,
      value: entry.value.toString(),
      basisQuantity: entry.basisQuantity.toString(),
      basisUnitCode: entry.basisUnitCode,
      displayOrder: entry.nutrient.displayOrder,
      sourceNutrientCode: entry.sourceNutrientCode,
    }));

  /*
   * Servings are filtered to the same release, and not for tidiness. 916 of the
   * 917 imported serving weights are DERIVED_FROM_SOURCE — recovered from that
   * release's own per-100 g and per-serving figures. Such a weight is only
   * valid against the values it was derived from, so pairing it with a
   * different dataset's composition would be a real error.
   */
  let serving = null as (typeof food.servings)[number] | null;

  if (input.servingId) {
    const found = food.servings.find((candidate) => candidate.id === input.servingId);

    if (!found) {
      /*
       * Either no such serving anywhere, or one belonging to another food. Both
       * are reported as not-found: distinguishing them would confirm the
       * existence of a row the caller has no business knowing about, and
       * neither is actionable differently.
       */
      const elsewhere = await client.foodServing.findUnique({
        where: { id: input.servingId },
        select: { id: true },
      });

      return elsewhere
        ? calculationError(
            "FOOD_SERVING_MISMATCH",
            "That serving belongs to a different food.",
          )
        : calculationError("SERVING_NOT_FOUND", "That serving is not available.");
    }

    if (found.sourceVersionId !== chosen.id) {
      return calculationError(
        "FOOD_SERVING_MISMATCH",
        "That serving comes from a different data release than this food's nutrition values.",
      );
    }

    serving = found;
  }

  const resolved = resolveEffectiveGrams({
    quantity: input.quantity,
    unit: input.unit,
    foodId: food.id,
    serving: serving
      ? {
          id: serving.id,
          foodId: serving.foodId,
          label: serving.label,
          weightGrams: serving.weightGrams?.toString() ?? null,
          weightMethod: serving.weightMethod,
        }
      : null,
  });

  if (!resolved.ok) return resolved;

  const calculated = calculateNutrientsFromGrams(
    composition,
    resolved.data.effectiveGrams,
  );

  if (!calculated.ok) return calculated;

  return {
    ok: true,
    data: {
      food: {
        id: food.id,
        name: food.canonicalName,
        category: food.category,
        foodType: food.foodType,
        preparationState: food.preparationState,
      },
      quantity: resolved.data.quantity.toString(),
      unit: resolved.data.unit,
      serving: resolved.data.serving,
      effectiveGrams: resolved.data.effectiveGrams.toString(),
      nutrients: calculated.data,
      unavailableNutrients: unavailableNutrientCodes(composition),
      provenance: {
        source: {
          code: chosen.source.code,
          name: chosen.source.name,
          permissionStatus: chosen.source.permissionStatus,
          attributionRequired: chosen.source.attributionRequired,
          attributionText: chosen.source.attributionText,
        },
        version: chosen.version,
        externalFoodId: food.originSourceFoodId,
      },
    },
  };
}
