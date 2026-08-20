"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireClinicalContext } from "@/lib/auth/dal";
import { QUANTITY_UNITS } from "@/lib/nutrition/calculate/types";
import {
  addPlanItem,
  createPlan,
  removePlanItem,
  updatePlanItemQuantity,
} from "@/services/nutrition/plans";
import { DECIMAL_LITERAL } from "@/validations/nutrition";

/**
 * Nutrition plan Server Actions.
 *
 * `requireClinicalContext()` is the first line of every action. It resolves the
 * practice from the **session** and refuses RECEPTIONIST and CLIENT, so neither
 * the organization nor the permission can be influenced by the request. The
 * `organizationId` passed to the service comes from there and from nowhere
 * else — never from a form field.
 *
 * Every mutation ends in `revalidatePath`. That is the whole of automatic
 * recalculation from the UI side: nothing stores a total, so re-rendering the
 * page recomputes it from the items. There is no "recalculate" step because
 * there is nothing stale to refresh.
 */

export type PlanActionState = {
  status: "idle" | "error";
  message?: string;
};

const MEAL_SLOTS = [
  "BREAKFAST",
  "MID_MORNING",
  "LUNCH",
  "EVENING_SNACK",
  "DINNER",
] as const;

/**
 * A quantity stays a string all the way to the engine.
 *
 * `z.coerce.number()` would turn "0.1" into a binary float before anything
 * could preserve it. Range and sign are the engine's rules, and it reports them
 * as typed, displayable errors.
 */
const quantitySchema = z
  .string()
  .trim()
  .min(1, "Enter a quantity")
  .max(20)
  .refine((value) => DECIMAL_LITERAL.test(value), "Quantity must be a plain number");

const addItemSchema = z
  .object({
    planId: z.uuid(),
    clientId: z.uuid(),
    mealSlot: z.enum(MEAL_SLOTS),
    foodId: z.uuid(),
    unit: z.enum(QUANTITY_UNITS),
    servingId: z.uuid().optional().nullable(),
    quantity: quantitySchema,
  })
  .refine((value) => value.unit !== "SERVING" || Boolean(value.servingId), {
    message: "Choose a serving, or enter the quantity in grams",
    path: ["servingId"],
  });

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export async function createPlanAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const { viewer } = await requireClinicalContext();

  const parsed = z
    .object({
      clientId: z.uuid(),
      name: z.string().trim().min(1, "Give the plan a name").max(120),
      planDate: z.string().min(1, "Choose a date"),
    })
    .safeParse({
      clientId: field(formData, "clientId"),
      name: field(formData, "name"),
      planDate: field(formData, "planDate"),
    });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const planDate = new Date(`${parsed.data.planDate}T00:00:00.000Z`);
  if (Number.isNaN(planDate.getTime())) {
    return { status: "error", message: "That date could not be read." };
  }

  const result = await createPlan(
    viewer.organizationId,
    parsed.data.clientId,
    viewer.membershipId,
    { name: parsed.data.name, planDate },
  );

  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "client-not-found"
          ? "That client is not available."
          : "The plan could not be created.",
    };
  }

  revalidatePath(`/clients/${parsed.data.clientId}`);
  redirect(`/clients/${parsed.data.clientId}/nutrition-plans/${result.data.id}`);
}

export async function addPlanItemAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const { viewer } = await requireClinicalContext();

  const parsed = addItemSchema.safeParse({
    planId: field(formData, "planId"),
    clientId: field(formData, "clientId"),
    mealSlot: field(formData, "mealSlot"),
    foodId: field(formData, "foodId"),
    unit: field(formData, "unit"),
    servingId: field(formData, "servingId") ?? null,
    quantity: field(formData, "quantity"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    };
  }

  const result = await addPlanItem(viewer.organizationId, parsed.data.planId, {
    mealSlot: parsed.data.mealSlot,
    foodId: parsed.data.foodId,
    servingId: parsed.data.servingId,
    quantity: parsed.data.quantity,
    unit: parsed.data.unit,
  });

  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "food-not-found"
          ? "That food is not in the database."
          : "The food could not be added.",
    };
  }

  revalidatePath(
    `/clients/${parsed.data.clientId}/nutrition-plans/${parsed.data.planId}`,
  );
  return { status: "idle" };
}

export async function updatePlanItemAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const { viewer } = await requireClinicalContext();

  const parsed = z
    .object({
      planId: z.uuid(),
      clientId: z.uuid(),
      itemId: z.uuid(),
      quantity: quantitySchema,
    })
    .safeParse({
      planId: field(formData, "planId"),
      clientId: field(formData, "clientId"),
      itemId: field(formData, "itemId"),
      quantity: field(formData, "quantity"),
    });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the quantity.",
    };
  }

  const result = await updatePlanItemQuantity(
    viewer.organizationId,
    parsed.data.planId,
    parsed.data.itemId,
    parsed.data.quantity,
  );

  if (!result.ok) {
    return { status: "error", message: "The quantity could not be updated." };
  }

  revalidatePath(
    `/clients/${parsed.data.clientId}/nutrition-plans/${parsed.data.planId}`,
  );
  return { status: "idle" };
}

export async function removePlanItemAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const { viewer } = await requireClinicalContext();

  const parsed = z
    .object({ planId: z.uuid(), clientId: z.uuid(), itemId: z.uuid() })
    .safeParse({
      planId: field(formData, "planId"),
      clientId: field(formData, "clientId"),
      itemId: field(formData, "itemId"),
    });

  if (!parsed.success) {
    return { status: "error", message: "That item could not be removed." };
  }

  const result = await removePlanItem(
    viewer.organizationId,
    parsed.data.planId,
    parsed.data.itemId,
  );

  if (!result.ok) {
    return { status: "error", message: "That item could not be removed." };
  }

  revalidatePath(
    `/clients/${parsed.data.clientId}/nutrition-plans/${parsed.data.planId}`,
  );
  return { status: "idle" };
}
