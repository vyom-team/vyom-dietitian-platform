import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { MealSlot } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Nutrition plan storage.
 *
 * Reads and writes the *inputs* a dietitian chose — food, serving, quantity,
 * slot. It stores no nutrient total, no percentage and no comparison: those are
 * derived by `services/nutrition/analysis.ts` on every read, which is exactly
 * what makes recalculation automatic. There is no cached figure that could
 * disagree with the items.
 *
 * SECURITY
 *
 * Every function takes `organizationId` as its first parameter, from
 * `requireClinicalContext()` and nowhere else, and every query filters on it.
 * A plan id from another practice resolves to nothing rather than to data.
 */

export type PlanMutationResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: "client-not-found" | "plan-not-found" | "food-not-found" | "failed";
    };

export type PlanSummary = {
  id: string;
  name: string;
  planDate: Date;
  itemCount: number;
  updatedAt: Date;
};

/** One client's plans, newest first. */
export async function listPlans(
  organizationId: string,
  clientId: string,
  client: PrismaClient = prisma,
): Promise<PlanSummary[]> {
  const plans = await client.nutritionPlan.findMany({
    where: { organizationId, clientId },
    orderBy: [{ planDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      planDate: true,
      updatedAt: true,
      _count: { select: { items: true } },
    },
  });

  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    planDate: plan.planDate,
    itemCount: plan._count.items,
    updatedAt: plan.updatedAt,
  }));
}

/**
 * Creates a plan for a client.
 *
 * Pins the client's latest completed assessment, so the targets this plan is
 * measured against stay fixed even if the client is reassessed later. Without
 * that, editing a weight would retroactively change what a reviewed plan was
 * compared to.
 */
export async function createPlan(
  organizationId: string,
  clientId: string,
  memberId: string,
  input: { name: string; planDate: Date; notes?: string | null },
  client: PrismaClient = prisma,
): Promise<PlanMutationResult<{ id: string }>> {
  try {
    const person = await client.client.findFirst({
      where: { id: clientId, organizationId },
      select: { id: true },
    });

    if (!person) return { ok: false, reason: "client-not-found" };

    const assessment = await client.nutritionAssessment.findFirst({
      where: { clientId, organizationId, status: "COMPLETED" },
      orderBy: [{ assessmentDate: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });

    const plan = await client.nutritionPlan.create({
      data: {
        organizationId,
        clientId,
        createdByMemberId: memberId,
        assessmentId: assessment?.id ?? null,
        name: input.name,
        planDate: input.planDate,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });

    return { ok: true, data: { id: plan.id } };
  } catch (error) {
    console.error("[plans] createPlan failed", { organizationId, clientId, error });
    return { ok: false, reason: "failed" };
  }
}

export type AddPlanItemInput = {
  mealSlot: MealSlot;
  foodId: string;
  servingId?: string | null;
  quantity: string;
  unit: "GRAM" | "SERVING";
};

/**
 * Adds a food to a plan.
 *
 * Records which source release the food's values were read from, so a later
 * dataset import cannot silently change a plan a practitioner already reviewed.
 */
export async function addPlanItem(
  organizationId: string,
  planId: string,
  input: AddPlanItemInput,
  client: PrismaClient = prisma,
): Promise<PlanMutationResult<{ id: string }>> {
  try {
    const plan = await client.nutritionPlan.findFirst({
      where: { id: planId, organizationId },
      select: { id: true },
    });

    if (!plan) return { ok: false, reason: "plan-not-found" };

    const food = await client.food.findFirst({
      where: { id: input.foodId, isActive: true },
      select: { id: true, originSourceVersionId: true },
    });

    if (!food) return { ok: false, reason: "food-not-found" };

    /*
     * Appended to the end of its slot. Position is explicit rather than implied
     * by insertion order so a future reorder does not need a migration.
     */
    const last = await client.nutritionPlanItem.findFirst({
      where: { planId, mealSlot: input.mealSlot },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const item = await client.nutritionPlanItem.create({
      data: {
        planId,
        mealSlot: input.mealSlot,
        position: (last?.position ?? -1) + 1,
        foodId: input.foodId,
        servingId: input.unit === "SERVING" ? (input.servingId ?? null) : null,
        quantity: input.quantity,
        unit: input.unit,
        sourceVersionId: food.originSourceVersionId,
      },
      select: { id: true },
    });

    await touch(client, planId);

    return { ok: true, data: { id: item.id } };
  } catch (error) {
    console.error("[plans] addPlanItem failed", { organizationId, planId, error });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Changes an item's quantity.
 *
 * The whole of automatic recalculation, from the storage side: nothing else has
 * to be updated, because no total was ever stored.
 */
export async function updatePlanItemQuantity(
  organizationId: string,
  planId: string,
  itemId: string,
  quantity: string,
  client: PrismaClient = prisma,
): Promise<PlanMutationResult> {
  try {
    const existing = await client.nutritionPlanItem.findFirst({
      where: { id: itemId, planId, plan: { organizationId } },
      select: { id: true },
    });

    if (!existing) return { ok: false, reason: "plan-not-found" };

    await client.nutritionPlanItem.update({
      where: { id: itemId },
      data: { quantity },
    });

    await touch(client, planId);

    return { ok: true, data: undefined };
  } catch (error) {
    console.error("[plans] updatePlanItemQuantity failed", {
      organizationId,
      planId,
      error,
    });
    return { ok: false, reason: "failed" };
  }
}

export async function removePlanItem(
  organizationId: string,
  planId: string,
  itemId: string,
  client: PrismaClient = prisma,
): Promise<PlanMutationResult> {
  try {
    const existing = await client.nutritionPlanItem.findFirst({
      where: { id: itemId, planId, plan: { organizationId } },
      select: { id: true },
    });

    if (!existing) return { ok: false, reason: "plan-not-found" };

    await client.nutritionPlanItem.delete({ where: { id: itemId } });
    await touch(client, planId);

    return { ok: true, data: undefined };
  } catch (error) {
    console.error("[plans] removePlanItem failed", { organizationId, planId, error });
    return { ok: false, reason: "failed" };
  }
}

/** Bumps the plan's updatedAt so a list reflects item edits. */
async function touch(client: PrismaClient, planId: string): Promise<void> {
  await client.nutritionPlan.update({
    where: { id: planId },
    data: { updatedAt: new Date() },
  });
}
