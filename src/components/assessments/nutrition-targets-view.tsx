import { AlertTriangle, FileWarning, Info, Lock } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type {
  MicronutrientTarget,
  Target,
  TargetProfile,
  TargetReference,
} from "@/lib/nutrition/targets/types";

/**
 * A client's nutrition targets, and — just as prominently — what could not be
 * calculated and why.
 *
 * The design principle is that an absent target must be as legible as a present
 * one. Most targets are unavailable today because the ICMR-NIN requirement
 * tables have not been licensed, and a screen that quietly showed six empty
 * rows would read as a broken feature rather than an honest one. Each says what
 * is missing and what would supply it.
 *
 * Nothing here calculates. Every figure arrives from the target service, and
 * the only transformation applied is display rounding.
 */
export function NutritionTargetsView({ profile }: { profile: TargetProfile }) {
  const calculatedCount = countCalculated(profile);

  return (
    <div className="space-y-8">
      {profile.warnings.length > 0 ? (
        <Alert>
          <Info className="size-4" aria-hidden="true" />
          <AlertTitle>Before you read these</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {profile.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="energy-heading" className="space-y-3">
        <h2 id="energy-heading" className="type-h3">
          Energy
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <TargetCard label="Resting energy" target={profile.basalMetabolicRate} />
          <TargetCard label="Total expenditure" target={profile.energyExpenditure} />
          <TargetCard label="Daily energy target" target={profile.energy} emphasis />
        </div>
      </section>

      <section aria-labelledby="macros-heading" className="space-y-3">
        <h2 id="macros-heading" className="type-h3">
          Macronutrients
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TargetCard label="Protein" target={profile.protein} />
          <TargetCard label="Carbohydrate" target={profile.carbohydrate} />
          <TargetCard label="Fat" target={profile.fat} />
          <TargetCard label="Fibre" target={profile.fibre} />
        </div>
      </section>

      {profile.micronutrients.length > 0 ? (
        <section aria-labelledby="micros-heading" className="space-y-3">
          <h2 id="micros-heading" className="type-h3">
            Micronutrients
          </h2>
          <MicronutrientTable micronutrients={profile.micronutrients} />
        </section>
      ) : null}

      <Separator />

      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading" className="type-h3">
          How Vyom calculated this
        </h2>

        {calculatedCount === 0 ? (
          <p className="type-body text-muted-foreground">
            Nothing could be calculated from the references currently licensed.
          </p>
        ) : (
          <div className="space-y-4">
            {profile.methodology.map((line) => (
              <p key={line} className="type-body">
                {line}
              </p>
            ))}

            <Derivation label="Daily energy target" target={profile.energy} />
            <Derivation label="Resting energy" target={profile.basalMetabolicRate} />
            <Derivation label="Protein" target={profile.protein} />
          </div>
        )}
      </section>

      <section aria-labelledby="references-heading" className="space-y-3">
        <h2 id="references-heading" className="type-h3">
          References
        </h2>

        {profile.references.length === 0 ? (
          <p className="type-body text-muted-foreground">
            No reference is cited because no target was derived from one.
          </p>
        ) : (
          <ul className="space-y-3">
            {profile.references.map((reference) => (
              <li key={referenceKey(reference)} className="type-body-sm">
                <ReferenceEntry reference={reference} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Alert>
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertTitle>Clinical judgement stays with you</AlertTitle>
        <AlertDescription>
          These are reference-derived figures, not a prescription. Vyom makes no
          clinical recommendation and does not classify this client.
        </AlertDescription>
      </Alert>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TargetCard({
  label,
  target,
  emphasis,
}: {
  label: string;
  target: Target;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? "rounded-lg border-2 border-primary/30 bg-primary/5 p-4"
          : "rounded-lg border p-4"
      }
    >
      <p className="type-caption">{label}</p>

      {target.status === "CALCULATED" ? (
        <>
          <p className="type-metric mt-1">
            {formatTarget(target)}
            <span className="type-body ml-1 font-normal text-muted-foreground">
              {unitLabel(target.unit)}
            </span>
          </p>
          <Badge variant="outline" className="mt-2">
            {valueTypeLabel(target.valueType)}
          </Badge>
        </>
      ) : (
        <UnavailableBody target={target} />
      )}
    </div>
  );
}

/**
 * The unavailable state.
 *
 * Never a dash, a zero, or an empty cell. A practitioner must be able to tell
 * "we have not licensed this reference" from "you did not record a weight",
 * because only one of those is something they can fix.
 */
function UnavailableBody({
  target,
}: {
  target: Extract<Target, { status: "UNAVAILABLE" }>;
}) {
  const isLicensing = target.reason === "REFERENCE_REQUIRED";

  return (
    <>
      <p className="type-body mt-2 flex items-center gap-1.5 font-medium">
        {isLicensing ? (
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <FileWarning className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        {reasonLabel(target.reason)}
      </p>
      <p className="type-caption mt-1">{target.detail}</p>
      {target.requiredReference ? (
        <p className="type-caption mt-2">
          Needs: {target.requiredReference.suggestedSource}
        </p>
      ) : null}
    </>
  );
}

function MicronutrientTable({
  micronutrients,
}: {
  micronutrients: MicronutrientTarget[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left">
        <thead className="border-b bg-muted/40">
          <tr>
            <th scope="col" className="type-caption px-4 py-2 font-medium">
              Nutrient
            </th>
            <th scope="col" className="type-caption px-4 py-2 text-right font-medium">
              Target
            </th>
            <th scope="col" className="type-caption px-4 py-2 font-medium">
              Basis
            </th>
          </tr>
        </thead>
        <tbody>
          {micronutrients.map((entry) => (
            <tr key={entry.code} className="border-b last:border-0">
              <td className="type-body px-4 py-2">{entry.name}</td>
              <td className="type-body px-4 py-2 text-right tabular-nums">
                {entry.target.status === "CALCULATED" ? (
                  <>
                    {formatTarget(entry.target)}{" "}
                    <span className="text-muted-foreground">
                      {unitLabel(entry.target.unit)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Not available</span>
                )}
              </td>
              <td className="type-caption px-4 py-2">
                {entry.target.status === "CALCULATED"
                  ? valueTypeLabel(entry.target.valueType)
                  : reasonLabel(entry.target.reason)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The "why this number?" panel — the step-by-step derivation. */
function Derivation({ label, target }: { label: string; target: Target }) {
  if (target.status !== "CALCULATED" || target.explanation.length === 0) return null;

  return (
    <details className="rounded-lg border p-4">
      <summary className="type-label cursor-pointer">
        Why is {label.toLowerCase()} {formatTarget(target)} {unitLabel(target.unit)}?
      </summary>

      <ol className="mt-3 space-y-2">
        {target.explanation.map((step, index) => (
          <li key={`${step.label}-${index}`} className="type-body-sm">
            <span className="font-medium">{step.label}</span>
            <span className="text-muted-foreground"> — {step.detail}</span>
            {step.value ? (
              <span className="tabular-nums">
                {" = "}
                {step.value} {step.unit ?? ""}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function ReferenceEntry({ reference }: { reference: TargetReference }) {
  if (reference.kind === "PUBLICATION") {
    return (
      <>
        <span className="font-medium">{reference.method}</span>
        <span className="block text-muted-foreground">{reference.citation}</span>
        {reference.populationCaveat ? (
          <span className="mt-1 block">{reference.populationCaveat}</span>
        ) : null}
      </>
    );
  }

  return (
    <>
      <span className="font-medium">
        {reference.sourceName} ({reference.sourceCode}) {reference.version}
      </span>
      {reference.permissionStatus !== "APPROVED" ? (
        <span className="block text-muted-foreground">
          Licensing not cleared for commercial use — {reference.permissionStatus}.
        </span>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Display rounding, and the only place it happens.
 *
 * Energy is whole; everything else keeps one decimal below 100. The unrounded
 * value stays on the target and is what any future calculation would read.
 */
function formatTarget(target: Extract<Target, { status: "CALCULATED" }>): string {
  if (target.kind === "RANGE") {
    return `${round(target.min, target.unit)}–${round(target.max, target.unit)}`;
  }
  return round(target.value, target.unit);
}

function round(value: string, unit: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (unit === "KCAL_PER_DAY") return amount.toFixed(0);
  return amount >= 100 ? amount.toFixed(0) : amount.toFixed(1);
}

function unitLabel(unit: string): string {
  const labels: Record<string, string> = {
    KCAL_PER_DAY: "kcal/day",
    G_PER_DAY: "g/day",
    MG_PER_DAY: "mg/day",
    UG_PER_DAY: "µg/day",
    G_PER_KG_PER_DAY: "g/kg/day",
    PERCENT_OF_ENERGY: "% of energy",
    FACTOR: "×",
  };
  return labels[unit] ?? unit;
}

/**
 * What the publisher called it. Never relabelled — an Adequate Intake shown as
 * an RDA would misrepresent the source's own confidence.
 */
function valueTypeLabel(valueType: string): string {
  const labels: Record<string, string> = {
    RDA: "RDA",
    EAR: "EAR",
    AI: "Adequate Intake",
    UL: "Upper limit",
    RANGE: "Published range",
    FACTOR: "Reference factor",
    EQUATION: "Calculated from equation",
  };
  return labels[valueType] ?? valueType;
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    REFERENCE_REQUIRED: "Reference required",
    INPUT_MISSING: "Information missing",
    INPUT_INVALID: "Recorded value unusable",
    POPULATION_UNSUPPORTED: "Not covered by any reference",
    DEPENDS_ON_UNAVAILABLE: "Depends on an earlier step",
  };
  return labels[reason] ?? "Not available";
}

function referenceKey(reference: TargetReference): string {
  return reference.kind === "PUBLICATION"
    ? `pub:${reference.method}`
    : `data:${reference.sourceCode}@${reference.version}`;
}

function countCalculated(profile: TargetProfile): number {
  const targets: Target[] = [
    profile.basalMetabolicRate,
    profile.energyExpenditure,
    profile.energy,
    profile.protein,
    profile.fat,
    profile.carbohydrate,
    profile.fibre,
    ...profile.micronutrients.map((entry) => entry.target),
  ];

  return targets.filter((target) => target.status === "CALCULATED").length;
}
