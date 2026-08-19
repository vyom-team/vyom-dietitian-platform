"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type CalculatorServing = {
  id: string;
  label: string;
  /** Null when the source published no weight — such a serving is not offered. */
  weightGrams: string | null;
};

/**
 * The calculator controls.
 *
 * State lives in the URL, exactly as the food filters do. A calculated result is
 * then linkable and survives a refresh, and — more importantly — the arithmetic
 * happens on the server in the nutrition service rather than in this component.
 * No nutrition value is computed here; this collects three inputs and navigates.
 *
 * Servings with no published weight are not offered at all. Listing one would
 * invite a practitioner to pick it and be told it cannot be used; leaving it out
 * and saying so once is honest and less irritating.
 */
export function NutritionCalculatorForm({
  foodId,
  servings,
  unit,
  quantity,
  servingId,
}: {
  foodId: string;
  servings: CalculatorServing[];
  unit: "GRAM" | "SERVING";
  quantity: string;
  servingId: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [draftQuantity, setDraftQuantity] = useState(quantity);

  const weighed = servings.filter((serving) => serving.weightGrams !== null);
  const canUseServings = weighed.length > 0;

  const push = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) search.delete(key);
      else search.set(key, value);
    }

    startTransition(() => {
      router.replace(search.size ? `/foods/${foodId}?${search}` : `/foods/${foodId}`, {
        scroll: false,
      });
    });
  };

  /*
   * Debounced, matching the food search. Every keystroke would otherwise be a
   * server round trip; 300 ms batches typing while still feeling immediate.
   */
  useEffect(() => {
    if (draftQuantity === quantity) return;

    const timer = setTimeout(() => push({ quantity: draftQuantity || undefined }), 300);
    return () => clearTimeout(timer);
    // `push` and `quantity` derive from the URL; depending on them would
    // re-trigger this effect and fight the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQuantity]);

  const selectUnit = (value: "GRAM" | "SERVING") =>
    push({
      unit: value,
      // A gram calculation has no serving; drop it so the URL stays honest.
      serving:
        value === "SERVING" ? (servingId ?? weighed[0]?.id ?? undefined) : undefined,
    });

  return (
    <div className="space-y-5">
      <Field>
        <FieldLabel htmlFor="calculator-unit-serving">Measure</FieldLabel>
        <ButtonGroup aria-label="How to measure this food">
          <Button
            id="calculator-unit-serving"
            type="button"
            variant={unit === "SERVING" ? "default" : "outline"}
            aria-pressed={unit === "SERVING"}
            disabled={!canUseServings}
            onClick={() => selectUnit("SERVING")}
          >
            By serving
          </Button>
          <Button
            type="button"
            variant={unit === "GRAM" ? "default" : "outline"}
            aria-pressed={unit === "GRAM"}
            onClick={() => selectUnit("GRAM")}
          >
            By weight
          </Button>
        </ButtonGroup>
        {canUseServings ? null : (
          <FieldDescription>
            This food has no serving weight published, so it can only be
            calculated by weight.
          </FieldDescription>
        )}
      </Field>

      {unit === "SERVING" && canUseServings ? (
        <Field>
          <FieldLabel htmlFor="calculator-serving">Serving</FieldLabel>
          <Select
            value={servingId ?? weighed[0]!.id}
            onValueChange={(value) => push({ serving: value })}
          >
            <SelectTrigger id="calculator-serving" className="w-full">
              <SelectValue placeholder="Choose a serving" />
            </SelectTrigger>
            <SelectContent>
              {weighed.map((serving) => (
                <SelectItem key={serving.id} value={serving.id}>
                  1 {serving.label} · {serving.weightGrams} g
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      <Field>
        <FieldLabel htmlFor="calculator-quantity">
          {unit === "SERVING" ? "Number of servings" : "Weight in grams"}
        </FieldLabel>
        <div className="relative">
          <Input
            id="calculator-quantity"
            name="quantity"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draftQuantity}
            onChange={(event) => setDraftQuantity(event.target.value)}
            placeholder={unit === "SERVING" ? "2" : "100"}
            className="pr-12 tabular-nums"
            aria-describedby="calculator-quantity-hint"
          />
          <span
            className="type-caption pointer-events-none absolute inset-y-0 right-3 flex items-center"
            aria-hidden="true"
          >
            {unit === "SERVING" ? "×" : "g"}
          </span>
        </div>
        <FieldDescription
          id="calculator-quantity-hint"
          className="flex items-center gap-1.5"
        >
          <Scale className="size-3 shrink-0" aria-hidden="true" />
          {unit === "SERVING"
            ? "Decimals are fine — 0.5 is half a serving."
            : "Enter the weight of the food as eaten."}
        </FieldDescription>
      </Field>

      <span aria-live="polite" className={cn("type-caption sr-only", isPending && "not-sr-only")}>
        {isPending ? "Calculating…" : ""}
      </span>
    </div>
  );
}
