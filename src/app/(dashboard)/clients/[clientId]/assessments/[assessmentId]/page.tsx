import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { Section } from "@/components/shared/section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { calculateBmi } from "@/lib/assessments/bmi";
import { requireClinicalContext } from "@/lib/auth/dal";
import { getAssessment } from "@/services/assessments";
import {
  ACTIVITY_LEVEL_LABELS,
  ASSESSMENT_TYPE_LABELS,
  DIET_TYPE_LABELS,
  PRIMARY_GOAL_LABELS,
} from "@/validations/assessment";

export const metadata: Metadata = { title: "Assessment" };

/**
 * A completed assessment, in full.
 *
 * This page shows health information, so it is behind
 * `requireClinicalContext()` — a RECEPTIONIST reaching this URL gets a 403, and
 * the RLS policy would refuse them at the database too.
 *
 * `getAssessment` is scoped by organization and caseload, so an assessment from
 * another practice returns null and renders as not-found — indistinguishable
 * from an id that never existed.
 */
export default async function AssessmentDetailPage({
  params,
}: PageProps<"/clients/[clientId]/assessments/[assessmentId]">) {
  const { clientId, assessmentId } = await params;
  const { viewer } = await requireClinicalContext();

  const assessment = await getAssessment(viewer, assessmentId);
  if (!assessment || assessment.clientId !== clientId) notFound();

  const name = `${assessment.clientFirstName} ${assessment.clientLastName}`;
  const bmi = calculateBmi(assessment.heightCm, assessment.weightKg);
  const isDraft = assessment.status === "DRAFT";

  return (
    <div className="space-y-8">
      <PageHeader
        title={ASSESSMENT_TYPE_LABELS[assessment.assessmentType]}
        description={`${name} · ${formatDate(assessment.assessmentDate)}`}
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Clients", href: "/clients" },
              { label: name, href: `/clients/${assessment.clientId}` },
              { label: "Assessment" },
            ]}
          />
        }
        secondaryActions={
          isDraft ? (
            <StatusBadge tone="warning">Draft</StatusBadge>
          ) : (
            <StatusBadge tone="success">Completed</StatusBadge>
          )
        }
        action={
          <Button variant="outline" asChild>
            <Link
              href={`/clients/${assessment.clientId}/assessments/${assessment.id}/edit`}
            >
              <Pencil className="size-4" aria-hidden="true" />
              {isDraft ? "Continue" : "Edit"}
            </Link>
          </Button>
        }
      />

      {isDraft ? (
        <div
          role="status"
          className="rounded-lg border border-warning/25 bg-warning-subtle p-4"
        >
          <p className="type-body-sm text-warning">
            This assessment is still a draft. Continue it to fill in the
            remaining details and mark it complete.
          </p>
        </div>
      ) : null}

      {/* Measurements — the one section worth surfacing prominently. */}
      <Section title="Measurements">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Metric
            label="Height"
            value={assessment.heightCm != null ? `${assessment.heightCm}` : null}
            unit="cm"
          />
          <Metric
            label="Weight"
            value={assessment.weightKg != null ? `${assessment.weightKg}` : null}
            unit="kg"
          />
          <Metric
            label="BMI"
            value={bmi.available ? bmi.display : null}
            /*
             * No category, no colour, no "healthy" label. Asian-Indian cutoffs
             * come from the PRD and are not in this codebase; applying WHO
             * defaults to Indian clients would be wrong, and inventing
             * thresholds would be worse.
             */
            note="Calculated from height and weight"
          />
        </dl>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Health background">
          <dl className="divide-y rounded-xl border bg-card px-5">
            <Row label="Health conditions" value={assessment.healthConditions} />
            <Row label="Medical history" value={assessment.medicalHistory} />
            <Row label="Medications" value={assessment.currentMedications} />
            <Row
              label="Allergies & intolerances"
              value={assessment.allergiesIntolerances}
            />
          </dl>
        </Section>

        <Section title="Lifestyle">
          <dl className="divide-y rounded-xl border bg-card px-5">
            <Row
              label="Activity level"
              value={
                assessment.activityLevel
                  ? ACTIVITY_LEVEL_LABELS[assessment.activityLevel]
                  : null
              }
            />
            <Row label="Exercise" value={assessment.exerciseFrequency} />
            <Row label="Occupation" value={assessment.occupation} />
            <Row label="Sleep" value={assessment.sleepPattern} />
            <Row
              label="Water"
              value={
                assessment.waterLitresPerDay != null
                  ? `${assessment.waterLitresPerDay} L/day`
                  : null
              }
            />
          </dl>
        </Section>

        <Section title="Diet">
          <dl className="divide-y rounded-xl border bg-card px-5">
            <Row
              label="Diet type"
              value={
                assessment.dietType === "OTHER"
                  ? assessment.dietTypeOther
                  : assessment.dietType
                    ? DIET_TYPE_LABELS[assessment.dietType]
                    : null
              }
            />
            <Row label="Preferences" value={assessment.foodPreferences} />
            <Row label="Disliked" value={assessment.foodsDisliked} />
            <Row label="Avoided" value={assessment.foodsAvoided} />
            <Row label="Restrictions" value={assessment.dietaryRestrictions} />
          </dl>
        </Section>

        <Section title="Goals">
          <dl className="divide-y rounded-xl border bg-card px-5">
            <Row
              label="Primary goal"
              value={
                assessment.primaryGoal === "OTHER"
                  ? assessment.primaryGoalOther
                  : assessment.primaryGoal
                    ? PRIMARY_GOAL_LABELS[assessment.primaryGoal]
                    : null
              }
            />
            <Row label="Notes" value={assessment.goalNotes} />
          </dl>
        </Section>
      </div>

      <Section title="Consultation notes">
        <div className="rounded-xl border bg-card p-5">
          {assessment.assessmentNotes ? (
            <p className="type-body whitespace-pre-wrap text-pretty">
              {assessment.assessmentNotes}
            </p>
          ) : (
            <p className="type-body text-muted-foreground">No notes recorded.</p>
          )}
        </div>
      </Section>

      <Section title="Record">
        <dl className="divide-y rounded-xl border bg-card px-5">
          <Row label="Recorded by" value={assessment.createdByName} />
          <Row label="Assessment date" value={formatDate(assessment.assessmentDate)} />
          <Row
            label="Completed"
            value={
              assessment.completedAt ? formatDateTime(assessment.completedAt) : null
            }
          />
          <Row label="Last updated" value={formatDateTime(assessment.updatedAt)} />
        </dl>
      </Section>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string | null;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <dt className="type-caption font-medium tracking-wide uppercase">{label}</dt>
      <dd className="mt-3">
        {value ? (
          <span className="type-metric">
            {value}
            {unit ? (
              <span className="type-body ml-1 font-normal text-muted-foreground">
                {unit}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="type-body text-muted-foreground">Not recorded</span>
        )}
        {note ? <p className="type-caption mt-2">{note}</p> : null}
      </dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid gap-0.5 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="type-caption sm:pt-0.5">{label}</dt>
      <dd
        className={`type-body break-words whitespace-pre-wrap sm:col-span-2 ${
          value ? "" : "text-muted-foreground"
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(date: Date): string {
  return new Date(date).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
