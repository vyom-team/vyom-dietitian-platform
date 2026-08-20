import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/nutrients";
import { aggregateNutrition } from "@/lib/nutrition/calculate/aggregate";
import type {
  AggregatedNutritionResult,
  NutritionCalculationResult,
} from "@/lib/nutrition/calculate/types";
import { compareNutrient } from "@/lib/nutrition/analysis/compare";
import {
  analysisError,
  MEAL_SLOTS,
  type AnalysisOutcome,
  type MealBreakdown,
  type NutrientComparison,
  type NutritionSummary,
} from "@/lib/nutrition/analysis/types";
import type { Target, TargetProfile } from "@/lib/nutrition/targets/types";
import { calculateFoodNutritionBatch } from "@/services/nutrition/calculate";
import { getNutritionTargets } from "@/services/nutrition/targets";

/**
 * Nutrition analysis service.
 *
 * Composes three engines that each own their own numbers:
 *
 *   Phase 8C  what is in this food          → calculateFoodNutritionBatch
 *   Phase 8C  what do these foods total     → aggregateNutrition
 *   Phase 8D  what does this client need    → getNutritionTargets
 *   Phase 8E  how do those two relate       → compareNutrient
 *
 * It calculates nothing itself. Every nutrient amount comes from 8C and every
 * target from 8D, which is what keeps one source of truth per number and makes
 * a wrong figure traceable to exactly one place.
 *
 * SECURITY
 *
 * A plan is client clinical data, so this is tenant-scoped. Every query filters
 * on the `organizationId` the caller proved access to via
 * `requireClinicalContext()` — never one supplied by the browser.
 *
 * NOTHING IS PERSISTED
 *
 * No total, percentage, or comparison is written back. They are functions of
 * the plan's stored inputs plus a source release, and a stored copy would go
 * stale the moment a dataset is corrected or a reference is licensed. That is
 * also what makes recalculation automatic: there is no cached figure that could
 * disagree with the items.
 */

/** The macronutrient targets, and which dictionary code each totals against. */
const MACRO_CODES = {
  energy: "ENERGY",
  protein: "PROTEIN",
  carbohydrate: "CARBOHYDRATE",
  fat: "FAT",
  fibre: "FIBRE",
} as const;

export type PlanItemView = {
  id: string;
  mealSlot: string;
  position: number;
  foodId: string;
  foodName: string;
  servingId: string | null;
  servingLabel: string | null;
  quantity: string;
  unit: string;
  /** The item's own calculated nutrition, or why it could not be calculated. */
  calculation:
    | { ok: true; data: NutritionCalculationResult }
    | { ok: false; code: string; message: string };
};

export type PlanAnalysis = {
  plan: {
    id: string;
    name: string;
    planDate: Date;
    clientId: string;
    /** Which assessment supplied the targets. Null when the client had none. */
    assessmentId: string | null;
  };
  items: PlanItemView[];
  meals: MealBreakdown[];
  /** The day's totals from Phase 8C, before comparison. */
  totals: AggregatedNutritionResult | null;
  summary: NutritionSummary;
  /** The full target profile, so a UI can explain a target without refetching. */
  targets: TargetProfile | null;
  /** Items whose calculation failed, so a UI can flag the row. */
  failedItems: { id: string; foodName: string; message: string }[];
};

/**
 * Analyses one plan: totals its food and compares against the client's targets.
 *
 * @param organizationId MUST come from `requireClinicalContext()`.
 * @param clientId verified to belong to that organization by the query itself
 * @param planId the plan to analyse
 * @param asOf the date age is computed against, for target derivation
 */
export async function getPlanAnalysis(
  organizationId: string,
  clientId: string,
  planId: string,
  asOf: Date = new Date(),
  client: PrismaClient = prisma,
): Promise<AnalysisOutcome<PlanAnalysis>> {
  /*
   * The tenant boundary. Scoping on organizationId AND clientId means a plan id
   * from another practice returns not-found rather than data.
   */
  const plan = await client.nutritionPlan.findFirst({
    where: { id: planId, clientId, organizationId },
    select: {
      id: true,
      name: true,
      planDate: true,
      clientId: true,
      assessmentId: true,
      items: {
        orderBy: [{ mealSlot: "asc" }, { position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          mealSlot: true,
          position: true,
          quantity: true,
          unit: true,
          food: { select: { id: true, canonicalName: true } },
          serving: { select: { id: true, label: true } },
        },
      },
    },
  });

  if (!plan) {
    return analysisError("PLAN_NOT_FOUND", "That plan is not available.");
  }

  /*
   * One query for every distinct food in the plan, not one per item. A day can
   * hold twenty items and the round trips would dominate the response.
   */
  const calculations = await calculateFoodNutritionBatch(
    plan.items.map((item) => ({
      key: item.id,
      foodId: item.food.id,
      quantity: item.quantity.toString(),
      unit: item.unit,
      servingId: item.serving?.id ?? null,
    })),
    client,
  );

  const byItemId = new Map(calculations.map((entry) => [entry.key, entry.result]));

  const items: PlanItemView[] = plan.items.map((item) => {
    const outcome = byItemId.get(item.id);

    return {
      id: item.id,
      mealSlot: item.mealSlot,
      position: item.position,
      foodId: item.food.id,
      foodName: item.food.canonicalName,
      servingId: item.serving?.id ?? null,
      servingLabel: item.serving?.label ?? null,
      quantity: item.quantity.toString(),
      unit: item.unit,
      calculation:
        outcome && outcome.ok
          ? { ok: true, data: outcome.data }
          : {
              ok: false,
              code: outcome && !outcome.ok ? outcome.error.code : "INVALID_PLAN_ITEM",
              message:
                outcome && !outcome.ok
                  ? outcome.error.message
                  : "This item could not be calculated.",
            },
    };
  });

  const failedItems = items
    .filter((item) => !item.calculation.ok)
    .map((item) => ({
      id: item.id,
      foodName: item.foodName,
      message: item.calculation.ok ? "" : item.calculation.message,
    }));

  /*
   * Only items that calculated contribute to a total. A failed item is reported
   * separately rather than silently counted as zero, which would understate
   * every nutrient in the plan.
   */
  const calculated: NutritionCalculationResult[] = items
    .map((item) => (item.calculation.ok ? item.calculation.data : null))
    .filter((entry): entry is NutritionCalculationResult => entry !== null);

  const aggregated = aggregateNutrition(calculated);
  const totals = aggregated.ok ? aggregated.data : null;

  const meals = buildMealBreakdowns(items);

  // Targets come from Phase 8D. This layer never derives one.
  const targetResult = await getNutritionTargets(organizationId, clientId, asOf, client);
  const targets = targetResult.ok ? targetResult.data : null;

  return {
    ok: true,
    data: {
      plan: {
        id: plan.id,
        name: plan.name,
        planDate: plan.planDate,
        clientId: plan.clientId,
        assessmentId: plan.assessmentId,
      },
      items,
      meals,
      totals,
      summary: buildSummary(totals, targets, calculated),
      targets,
      failedItems,
    },
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Builds the comparison summary.
 *
 * Every dictionary nutrient appears, whether or not the plan provides it and
 * whether or not a target exists — a nutrient missing from the output would be
 * indistinguishable from one at zero.
 */
function buildSummary(
  totals: AggregatedNutritionResult | null,
  targets: TargetProfile | null,
  calculated: readonly NutritionCalculationResult[],
): NutritionSummary {
  const byCode = new Map((totals?.nutrients ?? []).map((entry) => [entry.code, entry]));

  const compare = (code: string, target: Target | null): NutrientComparison => {
    const definition = NUTRIENT_DEFINITIONS.find((entry) => entry.code === code);
    const displayOrder = NUTRIENT_DEFINITIONS.findIndex((entry) => entry.code === code);

    return compareNutrient(byCode.get(code) ?? null, target ?? UNAVAILABLE_TARGET, {
      code,
      name: definition?.name ?? code,
      category: definition?.category ?? "OTHER",
      displayOrder: displayOrder < 0 ? Number.MAX_SAFE_INTEGER : displayOrder,
    });
  };

  const macroCodes = new Set<string>(Object.values(MACRO_CODES));

  const micronutrients = NUTRIENT_DEFINITIONS.filter(
    (definition) => !macroCodes.has(definition.code),
  ).map((definition) =>
    compare(
      definition.code,
      targets?.micronutrients.find((entry) => entry.code === definition.code)?.target ??
        null,
    ),
  );

  const energy = compare(MACRO_CODES.energy, targets?.energy ?? null);
  const protein = compare(MACRO_CODES.protein, targets?.protein ?? null);
  const carbohydrate = compare(MACRO_CODES.carbohydrate, targets?.carbohydrate ?? null);
  const fat = compare(MACRO_CODES.fat, targets?.fat ?? null);
  const fibre = compare(MACRO_CODES.fibre, targets?.fibre ?? null);

  const all = [energy, protein, carbohydrate, fat, fibre, ...micronutrients];

  return {
    energy,
    protein,
    carbohydrate,
    fat,
    fibre,
    micronutrients,
    coverage: {
      itemCount: calculated.length,
      completeNutrients: all.filter(
        (entry) => entry.actual !== undefined && entry.coverage === "COMPLETE",
      ).length,
      partialNutrients: all.filter((entry) => entry.coverage === "PARTIAL").length,
      unavailableNutrients: all
        .filter((entry) => entry.actual === undefined)
        .map((entry) => entry.code),
      targetsUnavailable: all.filter((entry) => entry.status === "TARGET_UNAVAILABLE")
        .length,
    },
    provenance: {
      foodSources: (totals?.sources ?? []).map((entry) => ({
        code: entry.source.code,
        name: entry.source.name,
        version: entry.version,
        permissionStatus: entry.source.permissionStatus,
      })),
      targetReferences: targets?.references ?? [],
    },
  };
}

/**
 * Stands in for a target Phase 8D did not produce.
 *
 * A plan can be analysed for a client with no assessment at all — the food
 * totals are still real and useful. Comparison then reports
 * TARGET_UNAVAILABLE rather than the summary omitting the nutrient.
 */
const UNAVAILABLE_TARGET: Target = {
  status: "UNAVAILABLE",
  reason: "REFERENCE_REQUIRED",
  detail: "No target is available for this nutrient.",
};

/** Per-slot totals, so a dietitian can see where the day's energy sits. */
function buildMealBreakdowns(items: readonly PlanItemView[]): MealBreakdown[] {
  return MEAL_SLOTS.map(({ slot, label }) => {
    const slotItems = items.filter((item) => item.mealSlot === slot);

    const calculated = slotItems
      .map((item) => (item.calculation.ok ? item.calculation.data : null))
      .filter((entry): entry is NutritionCalculationResult => entry !== null);

    const aggregated = aggregateNutrition(calculated);
    const totals = aggregated.ok ? aggregated.data : null;

    const value = (code: string) =>
      totals?.nutrients.find((entry) => entry.code === code)?.value;

    return {
      slot,
      label,
      itemCount: slotItems.length,
      energy: value(MACRO_CODES.energy),
      protein: value(MACRO_CODES.protein),
      carbohydrate: value(MACRO_CODES.carbohydrate),
      fat: value(MACRO_CODES.fat),
      fibre: value(MACRO_CODES.fibre),
      totalGrams: totals?.totalGrams ?? "0",
    };
  });
}
