"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  removePlanItemAction,
  updatePlanItemAction,
  type PlanActionState,
} from "@/lib/nutrition/plan-actions";
import { cn } from "@/lib/utils";

const INITIAL: PlanActionState = { status: "idle" };

/**
 * The quantity field for one plan item.
 *
 * Submits on its own, debounced, with **no Calculate button** — that is the
 * whole point of the phase. Nothing stores a total, so a successful submit
 * revalidates the page and every figure on it is recomputed from the items.
 * There is no cached number that could disagree.
 *
 * The arithmetic stays on the server. This component sends a string and renders
 * what comes back; it never multiplies anything, which is what keeps one
 * implementation of the nutrition formula rather than two that could drift.
 */
export function PlanItemQuantity({
  planId,
  clientId,
  itemId,
  quantity,
  unitLabel,
}: {
  planId: string;
  clientId: string;
  itemId: string;
  quantity: string;
  unitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(updatePlanItemAction, INITIAL);
  const [draft, setDraft] = useState(quantity);
  const [lastServerValue, setLastServerValue] = useState(quantity);
  const formRef = useRef<HTMLFormElement>(null);

  /*
   * A server revalidation re-renders this row with the stored quantity. Adopt
   * it, so an edit that was rejected snaps back to the truth rather than
   * leaving the field showing something the database does not hold.
   *
   * Adjusted during render rather than in an effect — React's documented way to
   * reset state when a prop changes. An effect would render the stale value
   * once first, and the debounce below would then fire on a change nobody made.
   */
  if (quantity !== lastServerValue) {
    setLastServerValue(quantity);
    setDraft(quantity);
  }

  useEffect(() => {
    if (draft === quantity) return;

    const timer = setTimeout(() => formRef.current?.requestSubmit(), 500);
    return () => clearTimeout(timer);
    // `quantity` is the server's value; depending on it would fight the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="itemId" value={itemId} />

      <Input
        name="quantity"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Quantity"
        aria-invalid={state.status === "error" ? true : undefined}
        className={cn("w-20 tabular-nums", isPending && "opacity-60")}
      />

      <span className="type-caption whitespace-nowrap">{unitLabel}</span>

      {/* Keyboard and no-JS path: the field submits without the debounce. */}
      <button type="submit" className="sr-only">
        Update quantity
      </button>

      {state.status === "error" ? (
        <span role="alert" className="type-caption text-destructive">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** Removes an item. Totals recompute on the resulting revalidation. */
export function RemovePlanItem({
  planId,
  clientId,
  itemId,
  foodName,
}: {
  planId: string;
  clientId: string;
  itemId: string;
  foodName: string;
}) {
  const [state, formAction, isPending] = useActionState(removePlanItemAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="itemId" value={itemId} />

      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={isPending}
        aria-label={`Remove ${foodName}`}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>

      {state.status === "error" ? (
        <span role="alert" className="type-caption text-destructive">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
