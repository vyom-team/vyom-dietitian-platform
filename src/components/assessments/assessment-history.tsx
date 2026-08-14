import Link from "next/link";
import { ArrowRight, ClipboardList, Pencil } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { calculateBmi } from "@/lib/assessments/bmi";
import type { AssessmentSummary } from "@/services/assessments";
import { ASSESSMENT_TYPE_LABELS } from "@/validations/assessment";

/**
 * A client's assessment history.
 *
 * A timeline rather than a table: these are consultations, and what matters is
 * when each happened and how the measurements moved — not columns to sort.
 *
 * Shows metadata and measurements only. Conditions, medications, allergies, and
 * notes live on the detail page; a summary list is not the place for health
 * detail nobody asked to see.
 */
export function AssessmentHistory({
  assessments,
  clientId,
}: {
  assessments: AssessmentSummary[];
  clientId: string;
}) {
  if (assessments.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No nutrition assessments yet"
        description="Start this client's first assessment to build their nutrition profile."
        action={
          <Button asChild>
            <Link href={`/clients/${clientId}/assessments/new`}>
              New assessment
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {assessments.map((assessment) => {
        const bmi = calculateBmi(assessment.heightCm, assessment.weightKg);
        const isDraft = assessment.status === "DRAFT";

        const href = isDraft
          ? `/clients/${clientId}/assessments/${assessment.id}/edit`
          : `/clients/${clientId}/assessments/${assessment.id}`;

        return (
          <li key={assessment.id}>
            <Link
              href={href}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="type-body font-medium">
                    {ASSESSMENT_TYPE_LABELS[assessment.assessmentType]}
                  </p>
                  {isDraft ? (
                    <StatusBadge tone="warning">Draft</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">Completed</StatusBadge>
                  )}
                </div>
                <p className="type-caption">
                  {formatDate(assessment.assessmentDate)}
                  {assessment.createdByName ? ` · ${assessment.createdByName}` : null}
                </p>
              </div>

              <dl className="flex items-center gap-5 sm:gap-6">
                <Measure label="Weight" value={
                  assessment.weightKg != null ? `${assessment.weightKg} kg` : null
                } />
                <Measure label="Height" value={
                  assessment.heightCm != null ? `${assessment.heightCm} cm` : null
                } />
                <Measure label="BMI" value={bmi.available ? bmi.display : null} />
              </dl>

              <span className="type-body-sm flex shrink-0 items-center gap-1 text-muted-foreground">
                {isDraft ? (
                  <>
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Continue
                  </>
                ) : (
                  <>
                    View
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Measure({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-14">
      <dt className="type-caption">{label}</dt>
      <dd
        className={`type-body-sm tabular-nums ${value ? "font-medium" : "text-muted-foreground"}`}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
