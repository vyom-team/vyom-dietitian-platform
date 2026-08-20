import { Info, Lock, ScaleIcon, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { nutrientUnitLabel } from "@/lib/nutrition/calculate/format";
import type {
  NutrientComparison,
  NutritionSummary,
} from "@/lib/nutrition/analysis/types";

/**
 * Target versus actual, for a whole day.
 *
 * The screen a dietitian reads instead of adding numbers by hand. Its job is to
 * make the gaps visible in seconds, and — just as importantly — to make the
 * *absence* of a number as legible as its presence.
 *
 * Three different kinds of "no number" are shown differently, because they need
 * different responses:
 *
 *   TARGET_UNAVAILABLE  we have no licensed reference    → Vyom's problem
 *   DATA_UNAVAILABLE    no food publishes this nutrient  → the dataset's gap
 *   INCOMPARABLE_UNITS  both exist but cannot be related → a data fault
 *
 * Nothing here calculates. Every figure arrives from the analysis service; the
 * only transformation is display rounding.
 */
export function NutritionSummaryView({ summary }: { summary: NutritionSummary }) {
  const macros = [
    summary.energy,
    summary.protein,
    summary.carbohydrate,
    summary.fat,
    summary.fibre,
  ];

  const withTargets = summary.micronutrients.filter(
    (entry) => entry.status !== "TARGET_UNAVAILABLE",
  );
  const provided = summary.micronutrients.filter(
    (entry) => entry.status === "TARGET_UNAVAILABLE" && entry.actual !== undefined,
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby="daily-heading" className="space-y-3">
        <h2 id="daily-heading" className="type-h3">
          Daily nutrition
        </h2>

        <div className="space-y-3">
          {macros.map((comparison) => (
            <ComparisonRow key={comparison.code} comparison={comparison} />
          ))}
        </div>
      </section>

      {summary.coverage.targetsUnavailable > 0 ? (
        <Alert>
          <Lock className="size-4" aria-hidden="true" />
          <AlertTitle>
            {summary.coverage.targetsUnavailable} of{" "}
            {summary.coverage.targetsUnavailable + withTargets.length} targets are not
            licensed
          </AlertTitle>
          <AlertDescription>
            The plan totals below are real. What is missing is the requirement to
            compare them against — see the client&apos;s nutrition targets for which
            reference is needed.
          </AlertDescription>
        </Alert>
      ) : null}

      {withTargets.length > 0 ? (
        <section aria-labelledby="micro-heading" className="space-y-3">
          <h2 id="micro-heading" className="type-h3">
            Micronutrients
          </h2>
          <div className="space-y-3">
            {withTargets.map((comparison) => (
              <ComparisonRow key={comparison.code} comparison={comparison} compact />
            ))}
          </div>
        </section>
      ) : null}

      {provided.length > 0 ? (
        <section aria-labelledby="provided-heading" className="space-y-3">
          <h2 id="provided-heading" className="type-h3">
            Also in this plan
          </h2>
          <p className="type-caption">
            Totalled from the food, with no licensed target to compare against.
          </p>
          <ProvidedTable comparisons={provided} />
        </section>
      ) : null}

      <Separator />

      <section aria-labelledby="coverage-heading" className="space-y-2">
        <h2 id="coverage-heading" className="type-h4">
          Data coverage
        </h2>

        <dl className="type-body-sm grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Row label="Foods totalled" value={String(summary.coverage.itemCount)} />
          <Row
            label="Nutrients from every food"
            value={String(summary.coverage.completeNutrients)}
          />
          <Row
            label="Nutrients from some foods"
            value={String(summary.coverage.partialNutrients)}
          />
          <Row
            label="Not published by any food"
            value={String(summary.coverage.unavailableNutrients.length)}
          />
        </dl>

        {summary.coverage.partialNutrients > 0 ? (
          <p className="type-caption">
            A partial total is a floor, not a total: at least one food published
            nothing for that nutrient, so the real figure is higher by an unknown
            amount.
          </p>
        ) : null}
      </section>

      {summary.provenance.foodSources.length > 0 ? (
        <section aria-labelledby="source-heading" className="space-y-2">
          <h2 id="source-heading" className="type-h4">
            Sources
          </h2>
          <ul className="type-body-sm space-y-1">
            {summary.provenance.foodSources.map((source) => (
              <li key={`${source.code}@${source.version}`}>
                {source.name} ({source.code}) {source.version}
                {source.permissionStatus !== "APPROVED" ? (
                  <span className="text-muted-foreground">
                    {" — "}licensing not cleared for commercial use
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** One nutrient: the bar, the numbers, and the honest absence where there is one. */
function ComparisonRow({
  comparison,
  compact,
}: {
  comparison: NutrientComparison;
  compact?: boolean;
}) {
  const percent = comparison.percentage ? Number(comparison.percentage) : null;

  return (
    <div className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={compact ? "type-body font-medium" : "type-h4"}>
          {comparison.name}
        </span>

        <span className="type-body tabular-nums">
          {describeAmounts(comparison)}
        </span>
      </div>

      {percent !== null ? (
        <>
          <Bar percent={percent} status={comparison.status} />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="type-caption tabular-nums">{percent.toFixed(1)}%</span>
            <StatusNote comparison={comparison} />
          </div>
        </>
      ) : (
        <div className="mt-2">
          <StatusNote comparison={comparison} />
        </div>
      )}
    </div>
  );
}

/**
 * The progress bar.
 *
 * Capped at 100% of the track width so an over-target nutrient does not
 * overflow, but the numeric percentage beside it is never capped — a plan at
 * 240% of a target must not look identical to one at 100%.
 */
function Bar({ percent, status }: { percent: number; status: string }) {
  const width = Math.max(0, Math.min(100, percent));

  const tone =
    status === "ABOVE_TARGET"
      ? "bg-warning"
      : status === "TARGET_MET"
        ? "bg-success"
        : "bg-primary";

  return (
    <div
      className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${percent.toFixed(1)} percent of target`}
    >
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function StatusNote({ comparison }: { comparison: NutrientComparison }) {
  if (comparison.status === "TARGET_UNAVAILABLE") {
    return (
      <span className="type-caption flex items-center gap-1.5">
        <Lock className="size-3 shrink-0" aria-hidden="true" />
        No licensed target
      </span>
    );
  }

  if (comparison.status === "DATA_UNAVAILABLE") {
    return (
      <span className="type-caption flex items-center gap-1.5">
        <Info className="size-3 shrink-0" aria-hidden="true" />
        Not published by any food in this plan — not zero
      </span>
    );
  }

  if (comparison.status === "INCOMPARABLE_UNITS") {
    return (
      <span className="type-caption flex items-center gap-1.5">
        <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
        Target and total are in different units
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {comparison.remaining ? (
        <span className="type-caption tabular-nums">
          {describeRemaining(comparison)}
        </span>
      ) : null}

      {comparison.targetType && comparison.targetType !== "RDA" ? (
        <Badge variant="outline">{comparison.targetType}</Badge>
      ) : null}

      {comparison.coverage === "PARTIAL" ? (
        <span className="type-caption flex items-center gap-1">
          <ScaleIcon className="size-3 shrink-0" aria-hidden="true" />
          {comparison.contributingItems} of {comparison.totalItems} foods
        </span>
      ) : null}
    </span>
  );
}

function ProvidedTable({ comparisons }: { comparisons: NutrientComparison[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left">
        <thead className="border-b bg-muted/40">
          <tr>
            <th scope="col" className="type-caption px-4 py-2 font-medium">
              Nutrient
            </th>
            <th scope="col" className="type-caption px-4 py-2 text-right font-medium">
              In this plan
            </th>
            <th scope="col" className="type-caption px-4 py-2 font-medium">
              Coverage
            </th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((entry) => (
            <tr key={entry.code} className="border-b last:border-0">
              <td className="type-body px-4 py-2">{entry.name}</td>
              <td className="type-body px-4 py-2 text-right tabular-nums">
                {entry.actual !== undefined && entry.unit
                  ? `${round(entry.actual, entry.unit)} ${nutrientUnitLabel(entry.unit)}`
                  : "Not available"}
              </td>
              <td className="type-caption px-4 py-2">
                {entry.coverage === "PARTIAL"
                  ? `${entry.contributingItems} of ${entry.totalItems} foods`
                  : "All foods"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting — the only place a calculated figure is rounded
// ---------------------------------------------------------------------------

function describeAmounts(comparison: NutrientComparison): string {
  const unit = comparison.unit ? nutrientUnitLabel(comparison.unit) : "";

  const actual =
    comparison.actual !== undefined && comparison.unit
      ? round(comparison.actual, comparison.unit)
      : "—";

  if (comparison.targetRange) {
    return `${actual} / ${comparison.targetRange.min}–${comparison.targetRange.max} ${unit}`;
  }

  if (comparison.target !== undefined && comparison.unit) {
    return `${actual} / ${round(comparison.target, comparison.unit)} ${unit}`;
  }

  return actual === "—" ? "Not available" : `${actual} ${unit}`;
}

function describeRemaining(comparison: NutrientComparison): string {
  if (!comparison.remaining || !comparison.unit) return "";

  const remaining = Number(comparison.remaining);
  const unit = nutrientUnitLabel(comparison.unit);

  if (remaining === 0) return "On target";
  if (remaining > 0) return `${round(comparison.remaining, comparison.unit)} ${unit} remaining`;

  return `${round(String(Math.abs(remaining)), comparison.unit)} ${unit} over`;
}

function round(value: string, unit: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (unit === "KCAL" || unit === "KJ") return Math.round(amount).toLocaleString("en-IN");
  return amount >= 100 ? amount.toFixed(0) : amount.toFixed(1);
}
