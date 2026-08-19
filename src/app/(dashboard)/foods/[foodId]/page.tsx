import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";

import { NutritionCalculatorForm } from "@/components/foods/nutrition-calculator-form";
import { NutritionResult } from "@/components/foods/nutrition-result";
import { DetailPage } from "@/components/templates/page-templates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireClinicalContext } from "@/lib/auth/dal";
import { calculateFoodNutrition } from "@/services/nutrition/calculate";
import { getFood } from "@/services/nutrition/search";
import { foodCalculationQuerySchema } from "@/validations/nutrition";

export const metadata: Metadata = { title: "Food" };

/**
 * One food, and the nutrition of a given amount of it.
 *
 * The first screen in Vyom that answers the question a dietitian actually has:
 * not "what is in 100 g of this" but "what is in the two bowls my client ate".
 *
 * ACCESS
 *
 * Reference data is global — the same food rows serve every practice, which is
 * correct and intended. It is still clinical by audience, so
 * `requireClinicalContext()` gates it exactly as the food list does, and RLS
 * enforces the same boundary independently at the database.
 *
 * NOTHING IS CALCULATED HERE
 *
 * The page reads inputs from the URL, hands them to the nutrition service, and
 * renders what comes back. No arithmetic lives in this file or in any component
 * it renders — that is the whole point of the domain/service split.
 */
export default async function FoodDetailPage({
  params,
  searchParams,
}: PageProps<"/foods/[foodId]">) {
  await requireClinicalContext();

  const { foodId } = await params;
  const food = await getFood(foodId);

  // An unknown id and a withdrawn food are the same answer to the reader.
  if (!food) notFound();

  const query = foodCalculationQuerySchema.parse(await searchParams);

  const weighedServings = food.servings.filter((serving) => serving.weightGrams !== null);

  /*
   * Defaults chosen so the page is useful on arrival rather than an empty form:
   * one serving where the source published a weight, otherwise 100 g — the basis
   * every value in the database is already expressed against.
   */
  const unit = query.unit ?? (weighedServings.length > 0 ? "SERVING" : "GRAM");
  const quantity = query.quantity ?? (unit === "SERVING" ? "1" : "100");
  const servingId =
    unit === "SERVING" ? (query.serving ?? weighedServings[0]?.id ?? null) : null;

  const result = await calculateFoodNutrition({
    foodId: food.id,
    quantity,
    unit,
    servingId,
  });

  return (
    <DetailPage
      title={food.canonicalName}
      description={describeFood(food)}
      breadcrumbs={[
        { label: "Food Database", href: "/foods" },
        { label: food.canonicalName },
      ]}
      action={
        <Button asChild variant="outline">
          <Link href="/foods">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All foods
          </Link>
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{titleCase(food.category)}</Badge>
        <Badge variant="outline">{titleCase(food.foodType)}</Badge>
        {food.preparationState !== "UNKNOWN" ? (
          <Badge variant="outline">{titleCase(food.preparationState)}</Badge>
        ) : null}
        {food.source ? (
          <Badge variant="secondary">
            {food.source.code} {food.source.version}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
        <section
          aria-labelledby="calculator-heading"
          className="rounded-lg border p-4 sm:p-5 lg:sticky lg:top-6"
        >
          <h2 id="calculator-heading" className="type-h3 mb-4">
            Calculate nutrition
          </h2>

          <NutritionCalculatorForm
            foodId={food.id}
            servings={food.servings}
            unit={unit}
            quantity={quantity}
            servingId={servingId}
          />
        </section>

        <section aria-labelledby="result-heading" className="min-w-0">
          <h2 id="result-heading" className="sr-only">
            Calculated nutrition
          </h2>

          {result.ok ? (
            <NutritionResult result={result.data} />
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>{errorTitle(result.error.code)}</AlertTitle>
              <AlertDescription>{result.error.message}</AlertDescription>
            </Alert>
          )}
        </section>
      </div>

      {food.aliases.length > 0 ? (
        <section aria-labelledby="aliases-heading">
          <h2 id="aliases-heading" className="type-h4 mb-2">
            Also known as
          </h2>
          <p className="type-body text-muted-foreground">{food.aliases.join(" · ")}</p>
        </section>
      ) : null}
    </DetailPage>
  );
}

/**
 * Headings for the error states, so a failure reads as a condition of the data
 * rather than as a malfunction. The sentence itself comes from the engine.
 */
function errorTitle(code: string): string {
  switch (code) {
    case "SERVING_WEIGHT_UNAVAILABLE":
      return "Serving weight unavailable";
    case "NUTRITION_DATA_UNAVAILABLE":
      return "No nutrition data";
    case "INVALID_QUANTITY":
      return "Check the quantity";
    case "SERVING_NOT_FOUND":
    case "FOOD_SERVING_MISMATCH":
    case "SERVING_REQUIRED":
      return "Choose a serving";
    case "UNSUPPORTED_UNIT":
      return "Unsupported unit";
    case "FOOD_NOT_FOUND":
      return "Food not found";
    default:
      return "Cannot calculate";
  }
}

function describeFood(food: {
  servings: { weightGrams: string | null }[];
  nutrients: unknown[];
}): string {
  const weighed = food.servings.filter((serving) => serving.weightGrams !== null).length;

  const parts = [
    `${food.nutrients.length} published ${food.nutrients.length === 1 ? "value" : "values"}`,
  ];

  parts.push(
    weighed === 0
      ? "no serving weight published"
      : `${weighed} ${weighed === 1 ? "serving" : "servings"} with a published weight`,
  );

  return parts.join(" · ");
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
}
