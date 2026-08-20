"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addPlanItemAction, type PlanActionState } from "@/lib/nutrition/plan-actions";

const INITIAL: PlanActionState = { status: "idle" };

export type AddFoodServing = {
  id: string;
  label: string;
  weightGrams: string | null;
};

/**
 * Adds one searched food to a meal slot.
 *
 * The serving picker offers only portions the source published a weight for.
 * Listing one without a weight would invite a dietitian to choose it and then
 * be told it cannot be converted — the food database deliberately holds such
 * rows, and this is where that honesty has to show up.
 */
export function AddFoodForm({
  planId,
  clientId,
  mealSlot,
  foodId,
  foodName,
  servings,
}: {
  planId: string;
  clientId: string;
  mealSlot: string;
  foodId: string;
  foodName: string;
  servings: AddFoodServing[];
}) {
  const [state, formAction, isPending] = useActionState(addPlanItemAction, INITIAL);

  const weighed = servings.filter((serving) => serving.weightGrams !== null);
  const defaultUnit = weighed.length > 0 ? "SERVING" : "GRAM";

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="mealSlot" value={mealSlot} />
      <input type="hidden" name="foodId" value={foodId} />

      {weighed.length > 0 ? (
        <>
          <input type="hidden" name="unit" value="SERVING" />
          <Select name="servingId" defaultValue={weighed[0]!.id}>
            <SelectTrigger
              className="w-56"
              aria-label={`Serving for ${foodName}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weighed.map((serving) => (
                <SelectItem key={serving.id} value={serving.id}>
                  1 {serving.label} · {serving.weightGrams} g
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      ) : (
        <input type="hidden" name="unit" value="GRAM" />
      )}

      <Input
        name="quantity"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={defaultUnit === "SERVING" ? "1" : "100"}
        aria-label={`Quantity of ${foodName}`}
        className="w-24 tabular-nums"
      />

      <span className="type-caption pb-2">
        {defaultUnit === "SERVING" ? "servings" : "grams"}
      </span>

      <Button type="submit" size="sm" disabled={isPending}>
        <Plus className="size-4" aria-hidden="true" />
        Add
      </Button>

      {state.status === "error" ? (
        <span role="alert" className="type-caption w-full text-destructive">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
