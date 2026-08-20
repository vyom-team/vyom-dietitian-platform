"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPlanAction, type PlanActionState } from "@/lib/nutrition/plan-actions";

const INITIAL: PlanActionState = { status: "idle" };

/** Creates a plan for one day. Redirects into it, so the next step is obvious. */
export function CreatePlanForm({ clientId }: { clientId: string }) {
  const [state, formAction, isPending] = useActionState(createPlanAction, INITIAL);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="flex w-full flex-wrap items-end gap-2">
      <input type="hidden" name="clientId" value={clientId} />

      <Input
        name="name"
        defaultValue="Day plan"
        maxLength={120}
        aria-label="Plan name"
        className="sm:w-56"
      />

      <Input
        name="planDate"
        type="date"
        defaultValue={today}
        aria-label="Plan date"
        className="sm:w-44"
      />

      <Button type="submit" disabled={isPending}>
        <Plus className="size-4" aria-hidden="true" />
        New plan
      </Button>

      {state.status === "error" ? (
        <span role="alert" className="type-caption w-full text-destructive">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
