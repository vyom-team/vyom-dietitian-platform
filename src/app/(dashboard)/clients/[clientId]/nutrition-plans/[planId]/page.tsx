import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, Search, Target, X } from "lucide-react";

import { AddFoodForm } from "@/components/nutrition/add-food-form";
import {
  PlanItemQuantity,
  RemovePlanItem,
} from "@/components/nutrition/plan-item-controls";
import { NutritionSummaryView } from "@/components/nutrition/nutrition-summary";
import { DetailPage } from "@/components/templates/page-templates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { requireClinicalContext } from "@/lib/auth/dal";
import { MEAL_SLOTS } from "@/lib/nutrition/analysis/types";
import { getClient } from "@/services/clients";
import { getPlanAnalysis, type PlanItemView } from "@/services/nutrition/analysis";
import { searchFoods } from "@/services/nutrition/search";

export const metadata: Metadata = { title: "Nutrition Plan" };

/**
 * The plan workspace — the screen this whole phase exists for.
 *
 * A dietitian adds foods and changes quantities; the totals and the comparison
 * against the client's targets recompute on every render. **There is no
 * Calculate button**, because nothing is stored that could be stale: the plan
 * holds only inputs, and every figure is derived from them on read.
 *
 * ACCESS
 *
 * `requireClinicalContext()` — a plan is built from a client's clinical targets
 * and is clinical data by audience. RECEPTIONIST and CLIENT are refused here,
 * by the service, and independently by RLS.
 *
 * NOTHING IS CALCULATED HERE
 *
 * The page reads, the analysis service composes 8C and 8D, the components
 * render. No nutrition arithmetic lives in this file.
 */
export default async function NutritionPlanPage({
  params,
  searchParams,
}: PageProps<"/clients/[clientId]/nutrition-plans/[planId]">) {
  const { clientId, planId } = await params;
  const { viewer } = await requireClinicalContext();

  const client = await getClient(viewer, clientId);
  if (!client) notFound();

  const analysis = await getPlanAnalysis(viewer.organizationId, clientId, planId);
  if (!analysis.ok) notFound();

  const { plan, items, meals, summary, failedItems } = analysis.data;

  const query = await searchParams;
  const addToSlot = single(query.slot);
  const term = single(query.q);

  /*
   * Food search runs on the server against the same service the food database
   * screen uses. Nothing ships the catalogue to the browser to filter there.
   */
  const foodResults =
    addToSlot && term
      ? await searchFoods({ query: term, pageSize: 6 })
      : null;

  const fullName = `${client.firstName} ${client.lastName}`;

  return (
    <DetailPage
      title={plan.name}
      description={`${plan.planDate.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })} · ${fullName}`}
      breadcrumbs={[
        { label: "Clients", href: "/clients" },
        { label: fullName, href: `/clients/${clientId}` },
        { label: "Nutrition plans", href: `/clients/${clientId}/nutrition-plans` },
        { label: plan.name },
      ]}
      action={
        <Button asChild variant="outline">
          <Link href={`/clients/${clientId}/nutrition-targets`}>
            <Target className="size-4" aria-hidden="true" />
            Targets
          </Link>
        </Button>
      }
    >
      {failedItems.length > 0 ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {failedItems.length} {failedItems.length === 1 ? "food" : "foods"} could not
            be calculated
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {failedItems.map((item) => (
                <li key={item.id}>
                  {item.foodName} — {item.message}
                </li>
              ))}
            </ul>
            <p>
              These are excluded from the totals below rather than counted as zero,
              which would understate every nutrient in the plan.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:items-start">
        <div className="space-y-6">
          {MEAL_SLOTS.map(({ slot, label }) => {
            const slotItems = items.filter((item) => item.mealSlot === slot);
            const breakdown = meals.find((meal) => meal.slot === slot)!;
            const isAdding = addToSlot === slot;

            return (
              <section
                key={slot}
                aria-labelledby={`slot-${slot}`}
                className="rounded-lg border p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`slot-${slot}`} className="type-h4">
                    {label}
                  </h2>
                  <p className="type-caption tabular-nums">
                    {breakdown.energy
                      ? `${Math.round(Number(breakdown.energy)).toLocaleString("en-IN")} kcal`
                      : "No energy data"}
                    {breakdown.protein
                      ? ` · ${Number(breakdown.protein).toFixed(1)} g protein`
                      : ""}
                  </p>
                </div>

                {slotItems.length > 0 ? (
                  <ul className="mt-3 divide-y">
                    {slotItems.map((item) => (
                      <PlanItemRow
                        key={item.id}
                        item={item}
                        planId={plan.id}
                        clientId={clientId}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="type-caption mt-3">Nothing added yet.</p>
                )}

                <div className="mt-4 border-t pt-4">
                  {isAdding ? (
                    <div className="space-y-3">
                      <form method="get" className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="slot" value={slot} />
                        <InputGroup className="sm:max-w-xs">
                          <InputGroupAddon>
                            <Search className="size-4" aria-hidden="true" />
                          </InputGroupAddon>
                          <InputGroupInput
                            name="q"
                            defaultValue={term ?? ""}
                            placeholder={`Search a food for ${label.toLowerCase()}`}
                            aria-label={`Search a food for ${label}`}
                          />
                        </InputGroup>
                        <Button type="submit" variant="outline" size="sm">
                          Search
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/clients/${clientId}/nutrition-plans/${plan.id}`}>
                            <X className="size-4" aria-hidden="true" />
                            Done
                          </Link>
                        </Button>
                      </form>

                      {foodResults ? (
                        foodResults.results.length === 0 ? (
                          <p className="type-caption">
                            No food matches. Search does not guess between spellings.
                          </p>
                        ) : (
                          <ul className="space-y-3">
                            {foodResults.results.map((food) => (
                              <li key={food.id} className="rounded-md border p-3">
                                <p className="type-body font-medium">
                                  {food.canonicalName}
                                </p>
                                <div className="mt-2">
                                  <AddFoodForm
                                    planId={plan.id}
                                    clientId={clientId}
                                    mealSlot={slot}
                                    foodId={food.id}
                                    foodName={food.canonicalName}
                                    servings={food.servings}
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                        )
                      ) : null}
                    </div>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/clients/${clientId}/nutrition-plans/${plan.id}?slot=${slot}`}
                        scroll={false}
                      >
                        Add food
                      </Link>
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="xl:sticky xl:top-6">
          <NutritionSummaryView summary={summary} />
        </div>
      </div>
    </DetailPage>
  );
}

function PlanItemRow({
  item,
  planId,
  clientId,
}: {
  item: PlanItemView;
  planId: string;
  clientId: string;
}) {
  const energy = item.calculation.ok
    ? item.calculation.data.nutrients.find((entry) => entry.code === "ENERGY")
    : undefined;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="type-body font-medium">{item.foodName}</p>
        <p className="type-caption">
          {item.servingLabel ? `1 ${item.servingLabel}` : "By weight"}
          {item.calculation.ok
            ? ` · ${Number(item.calculation.data.effectiveGrams).toFixed(0)} g total`
            : ` · ${item.calculation.message}`}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="type-caption tabular-nums">
          {energy ? `${Math.round(Number(energy.value))} kcal` : "—"}
        </span>

        <PlanItemQuantity
          planId={planId}
          clientId={clientId}
          itemId={item.id}
          quantity={item.quantity}
          unitLabel={item.unit === "SERVING" ? "×" : "g"}
        />

        <RemovePlanItem
          planId={planId}
          clientId={clientId}
          itemId={item.id}
          foodName={item.foodName}
        />
      </div>
    </li>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.at(-1);
  return value || undefined;
}
