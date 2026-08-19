import { AlertTriangle, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  formatGrams,
  formatNutrientValue,
  formatQuantity,
  nutrientUnitLabel,
} from "@/lib/nutrition/calculate/format";
import { NUTRIENT_BY_CODE } from "@/lib/nutrition/nutrients";
import type {
  CalculatedNutrient,
  NutritionCalculationResult,
} from "@/lib/nutrition/calculate/types";

/**
 * A calculated nutrition result, laid out for a dietitian to scan.
 *
 * Energy and the macronutrients sit at the top because they are what a
 * practitioner reads first; minerals and vitamins follow in the dictionary's own
 * order. Nothing is computed in this component — every figure arrives already
 * calculated, and the only transformation applied here is display rounding.
 *
 * Incomplete data is shown, never hidden. The nutrients this source did not
 * publish are named at the bottom rather than omitted silently, because a
 * missing row and a zero row look identical once one of them is left out.
 */
export function NutritionResult({ result }: { result: NutritionCalculationResult }) {
  const headline = result.nutrients.filter((nutrient) =>
    HEADLINE_CODES.includes(nutrient.code),
  );
  const minerals = result.nutrients.filter((nutrient) => nutrient.category === "MINERAL");
  const vitamins = result.nutrients.filter((nutrient) => nutrient.category === "VITAMIN");
  const others = result.nutrients.filter(
    (nutrient) =>
      !HEADLINE_CODES.includes(nutrient.code) &&
      nutrient.category !== "MINERAL" &&
      nutrient.category !== "VITAMIN",
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby="result-basis" className="rounded-lg border p-4 sm:p-5">
        <h3 id="result-basis" className="sr-only">
          What was calculated
        </h3>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Figure label="Quantity" value={formatQuantity(result.quantity)} />
          <Figure
            label="Serving"
            value={result.serving ? `1 ${result.serving.label}` : "By weight"}
            hint={
              result.serving ? `${formatGrams(result.serving.weightGrams)} g each` : undefined
            }
          />
          <Figure
            label="Total weight"
            value={`${formatGrams(result.effectiveGrams)} g`}
          />
          <Figure
            label="Preparation"
            value={
              result.food.preparationState === "UNKNOWN"
                ? "Not stated"
                : titleCase(result.food.preparationState)
            }
          />
        </dl>
      </section>

      {headline.length > 0 ? (
        <section aria-labelledby="result-headline">
          <h3 id="result-headline" className="type-h4 mb-3">
            Energy and macronutrients
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {headline.map((nutrient) => (
              <HeadlineNutrient key={nutrient.code} nutrient={nutrient} />
            ))}
          </div>
        </section>
      ) : null}

      {minerals.length > 0 ? (
        <NutrientTable title="Minerals" nutrients={minerals} />
      ) : null}
      {vitamins.length > 0 ? (
        <NutrientTable title="Vitamins" nutrients={vitamins} />
      ) : null}
      {others.length > 0 ? <NutrientTable title="Other" nutrients={others} /> : null}

      <Separator />

      <section aria-labelledby="result-source" className="space-y-3">
        <h3 id="result-source" className="type-h4">
          Where these numbers come from
        </h3>

        <dl className="type-body-sm grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <SourceRow
            label="Source"
            value={`${result.provenance.source.name} (${result.provenance.source.code})`}
          />
          <SourceRow label="Release" value={result.provenance.version} />
          {result.provenance.externalFoodId ? (
            <SourceRow label="Source record" value={result.provenance.externalFoodId} />
          ) : null}
          {result.serving ? (
            <SourceRow
              label="Serving weight"
              value={describeWeightMethod(result.serving.weightMethod)}
            />
          ) : null}
        </dl>

        {result.provenance.source.attributionText ? (
          <p className="type-caption">{result.provenance.source.attributionText}</p>
        ) : null}
      </section>

      {result.unavailableNutrients.length > 0 ? (
        <Alert>
          <Info className="size-4" aria-hidden="true" />
          <AlertTitle>
            {result.unavailableNutrients.length}{" "}
            {result.unavailableNutrients.length === 1 ? "nutrient is" : "nutrients are"}{" "}
            not published for this food
          </AlertTitle>
          <AlertDescription>
            <p>
              {result.provenance.source.code} does not measure{" "}
              {listNutrientNames(result.unavailableNutrients)}. These are absent from the
              source, not zero — treat them as unknown rather than as none.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {result.provenance.source.permissionStatus !== "APPROVED" ? (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Development data</AlertTitle>
          <AlertDescription>
            These values come from a dataset whose licensing has not been cleared for
            commercial use. Verify against the published source before relying on them
            clinically.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** Energy first, then the macronutrients a practitioner reads at a glance. */
const HEADLINE_CODES = [
  "ENERGY",
  "PROTEIN",
  "CARBOHYDRATE",
  "FAT",
  "FIBRE",
  "SUGARS",
];

function HeadlineNutrient({ nutrient }: { nutrient: CalculatedNutrient }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="type-caption">{nutrient.name}</p>
      <p className="type-metric mt-1">
        {formatNutrientValue(nutrient.value, nutrient.unit)}
        <span className="type-body ml-1 font-normal text-muted-foreground">
          {nutrientUnitLabel(nutrient.unit)}
        </span>
      </p>
      <p className="type-caption mt-2">
        {nutrient.basis.value} {nutrientUnitLabel(nutrient.unit)} per{" "}
        {nutrient.basis.quantity} {nutrient.basis.unitCode}
      </p>
    </div>
  );
}

function NutrientTable({
  title,
  nutrients,
}: {
  title: string;
  nutrients: CalculatedNutrient[];
}) {
  return (
    <section aria-labelledby={`result-${title.toLowerCase()}`}>
      <h3 id={`result-${title.toLowerCase()}`} className="type-h4 mb-3">
        {title}
      </h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left">
          <thead className="border-b bg-muted/40">
            <tr>
              <th scope="col" className="type-caption px-4 py-2 font-medium">
                Nutrient
              </th>
              <th scope="col" className="type-caption px-4 py-2 text-right font-medium">
                Amount
              </th>
              <th scope="col" className="type-caption px-4 py-2 text-right font-medium">
                Per {nutrients[0]?.basis.quantity ?? 100} {nutrients[0]?.basis.unitCode ?? "g"}
              </th>
            </tr>
          </thead>
          <tbody>
            {nutrients.map((nutrient) => (
              <tr key={nutrient.code} className="border-b last:border-0">
                <td className="type-body px-4 py-2">{nutrient.name}</td>
                <td className="type-body px-4 py-2 text-right tabular-nums">
                  {formatNutrientValue(nutrient.value, nutrient.unit)}{" "}
                  <span className="text-muted-foreground">
                    {nutrientUnitLabel(nutrient.unit)}
                  </span>
                </td>
                <td className="type-caption px-4 py-2 text-right tabular-nums">
                  {nutrient.basis.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="type-caption">{label}</dt>
      <dd className="type-body mt-0.5 font-medium tabular-nums">{value}</dd>
      {hint ? <dd className="type-caption">{hint}</dd> : null}
    </div>
  );
}

function SourceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 sm:justify-start">
      <dt className="type-caption shrink-0">{label}</dt>
      <dd className="type-body-sm text-right sm:text-left">{value}</dd>
    </div>
  );
}

/**
 * Plain wording for how a serving weight was established.
 *
 * A derived weight is not a published one, and a practitioner deciding whether
 * to trust a portion size should be able to tell the difference.
 */
function describeWeightMethod(method: string): string {
  if (method === "PUBLISHED") return "Published by the source";
  if (method === "DERIVED_FROM_SOURCE") return "Derived from the source's own figures";
  return "Not established";
}

function listNutrientNames(codes: string[]): string {
  const names = codes.map((code) => NUTRIENT_BY_CODE.get(code)?.name ?? code);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
