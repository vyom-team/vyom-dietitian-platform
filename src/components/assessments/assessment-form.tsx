"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, Save } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { calculateBmi } from "@/lib/assessments/bmi";
import type { AssessmentActionState } from "@/lib/assessments/actions";
import type { AssessmentDetail } from "@/services/assessments";
import {
  ACTIVITY_LEVELS,
  ACTIVITY_LEVEL_HINTS,
  ACTIVITY_LEVEL_LABELS,
  ASSESSMENT_TYPES,
  ASSESSMENT_TYPE_LABELS,
  DIET_TYPES,
  DIET_TYPE_LABELS,
  PRIMARY_GOALS,
  PRIMARY_GOAL_LABELS,
} from "@/validations/assessment";

const initialState: AssessmentActionState = { status: "idle" };

/**
 * Nutrition assessment form.
 *
 * One page of labelled sections rather than a wizard. A dietitian fills this in
 * during a consultation, often out of order as the conversation goes — a wizard
 * that forces a sequence would fight the way the work actually happens. The
 * sections give structure; the single page gives freedom of movement.
 *
 * Two submit buttons, distinguished by an `intent` field:
 *
 *   Save draft → lenient validation, come back later
 *   Complete   → strict validation, requires height, weight, and a goal
 *
 * BMI updates live from the two measurement inputs. It is displayed and never
 * submitted — the server derives it from the stored values.
 */
export function AssessmentForm({
  action,
  clientId,
  clientName,
  assessment,
  cancelHref,
}: {
  action: (
    state: AssessmentActionState,
    formData: FormData,
  ) => Promise<AssessmentActionState>;
  clientId: string;
  clientName: string;
  assessment?: AssessmentDetail;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, initialState);

  // Mirrored in React only so BMI can update as the practitioner types.
  const [heightCm, setHeightCm] = useState(
    assessment?.heightCm != null ? String(assessment.heightCm) : "",
  );
  const [weightKg, setWeightKg] = useState(
    assessment?.weightKg != null ? String(assessment.weightKg) : "",
  );
  const [dietType, setDietType] = useState(assessment?.dietType ?? "");
  const [primaryGoal, setPrimaryGoal] = useState(assessment?.primaryGoal ?? "");

  const bmi = calculateBmi(
    heightCm === "" ? null : Number(heightCm),
    weightKg === "" ? null : Number(weightKg),
  );

  const error = (field: string) => state.fieldErrors?.[field];
  const isCompleted = assessment?.status === "COMPLETED";

  return (
    <form action={formAction} noValidate className="space-y-8">
      <input type="hidden" name="clientId" value={clientId} />
      {assessment ? (
        <input type="hidden" name="assessmentId" value={assessment.id} />
      ) : null}

      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive-subtle p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="text-pretty">{state.message}</p>
        </div>
      ) : null}

      {/* 1 — Assessment information ----------------------------------- */}
      <FieldSet>
        <FieldLegend>Assessment</FieldLegend>
        <FieldDescription>
          For {clientName}. Recorded by you.
        </FieldDescription>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="assessmentDate">Assessment date</FieldLabel>
              <Input
                id="assessmentDate"
                name="assessmentDate"
                type="date"
                required
                defaultValue={
                  assessment
                    ? toDateInput(assessment.assessmentDate)
                    : todayInput()
                }
                aria-invalid={error("assessmentDate") ? true : undefined}
                aria-describedby={
                  error("assessmentDate") ? "assessmentDate-error" : undefined
                }
              />
              <FieldError id="assessmentDate-error" message={error("assessmentDate")} />
            </Field>

            <Field>
              <FieldLabel htmlFor="assessmentType">Type</FieldLabel>
              <Select
                name="assessmentType"
                defaultValue={assessment?.assessmentType ?? "INITIAL"}
              >
                <SelectTrigger id="assessmentType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSESSMENT_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ASSESSMENT_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError
                id="assessmentType-error"
                message={error("assessmentType")}
              />
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      {/* 2 — Measurements --------------------------------------------- */}
      <FieldSet>
        <FieldLegend>Measurements</FieldLegend>
        <FieldDescription>
          Required to complete the assessment.
        </FieldDescription>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="heightCm">Height</FieldLabel>
              <div className="relative">
                <Input
                  id="heightCm"
                  name="heightCm"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  className="pr-10"
                  value={heightCm}
                  onChange={(event) => setHeightCm(event.target.value)}
                  aria-invalid={error("heightCm") ? true : undefined}
                  aria-describedby={error("heightCm") ? "heightCm-error" : undefined}
                />
                <Unit>cm</Unit>
              </div>
              <FieldError id="heightCm-error" message={error("heightCm")} />
            </Field>

            <Field>
              <FieldLabel htmlFor="weightKg">Weight</FieldLabel>
              <div className="relative">
                <Input
                  id="weightKg"
                  name="weightKg"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  className="pr-10"
                  value={weightKg}
                  onChange={(event) => setWeightKg(event.target.value)}
                  aria-invalid={error("weightKg") ? true : undefined}
                  aria-describedby={error("weightKg") ? "weightKg-error" : undefined}
                />
                <Unit>kg</Unit>
              </div>
              <FieldError id="weightKg-error" message={error("weightKg")} />
            </Field>

            {/*
              Derived, never submitted. The server recalculates from the stored
              measurements, so a tampered value would have nowhere to go.
            */}
            <Field>
              <FieldLabel htmlFor="bmi-display">BMI</FieldLabel>
              <output
                id="bmi-display"
                aria-live="polite"
                className="flex h-8 items-center rounded-lg border bg-muted/40 px-3 text-sm tabular-nums"
              >
                {bmi.available ? (
                  bmi.display
                ) : (
                  <span className="text-muted-foreground">Not available</span>
                )}
              </output>
              <FieldDescription>
                Calculated from height and weight.
              </FieldDescription>
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      {/* 3 — Health --------------------------------------------------- */}
      <FieldSet>
        <FieldLegend>Health background</FieldLegend>
        <FieldDescription>
          What the client reports. Recorded as written — nothing here is
          interpreted or diagnosed by the system.
        </FieldDescription>
        <FieldGroup>
          <Notes
            id="healthConditions"
            label="Health conditions"
            defaultValue={assessment?.healthConditions}
            placeholder="Conditions relevant to nutrition care."
          />
          <Notes
            id="medicalHistory"
            label="Medical history"
            defaultValue={assessment?.medicalHistory}
            placeholder="Relevant past history."
          />
          <Notes
            id="currentMedications"
            label="Current medications"
            defaultValue={assessment?.currentMedications}
            placeholder="Medications and supplements the client is taking."
          />
          <Notes
            id="allergiesIntolerances"
            label="Allergies and intolerances"
            defaultValue={assessment?.allergiesIntolerances}
            placeholder="e.g. peanut allergy, lactose intolerance."
            description="Safety constraints only. Food dislikes belong under Diet."
          />
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      {/* 4 — Lifestyle ------------------------------------------------ */}
      <FieldSet>
        <FieldLegend>Lifestyle</FieldLegend>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="activityLevel">Activity level</FieldLabel>
              <Select
                name="activityLevel"
                defaultValue={assessment?.activityLevel ?? undefined}
              >
                <SelectTrigger id="activityLevel">
                  <SelectValue placeholder="Not recorded" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_LEVELS.map((value) => (
                    <SelectItem key={value} value={value}>
                      <span className="flex flex-col items-start">
                        <span>{ACTIVITY_LEVEL_LABELS[value]}</span>
                        <span className="type-caption">
                          {ACTIVITY_LEVEL_HINTS[value]}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="exerciseFrequency">Exercise</FieldLabel>
              <Input
                id="exerciseFrequency"
                name="exerciseFrequency"
                placeholder="e.g. walks 30 min, 4 days a week"
                defaultValue={assessment?.exerciseFrequency ?? undefined}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="occupation">Occupation</FieldLabel>
              <Input
                id="occupation"
                name="occupation"
                defaultValue={assessment?.occupation ?? undefined}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="sleepPattern">Sleep</FieldLabel>
              <Input
                id="sleepPattern"
                name="sleepPattern"
                placeholder="e.g. 6–7 hours, irregular"
                defaultValue={assessment?.sleepPattern ?? undefined}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="waterLitresPerDay">Water</FieldLabel>
              <div className="relative">
                <Input
                  id="waterLitresPerDay"
                  name="waterLitresPerDay"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  className="pr-14"
                  defaultValue={
                    assessment?.waterLitresPerDay != null
                      ? String(assessment.waterLitresPerDay)
                      : undefined
                  }
                  aria-invalid={error("waterLitresPerDay") ? true : undefined}
                />
                <Unit>L/day</Unit>
              </div>
              <FieldError
                id="waterLitresPerDay-error"
                message={error("waterLitresPerDay")}
              />
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      {/* 5 — Diet ----------------------------------------------------- */}
      <FieldSet>
        <FieldLegend>Diet</FieldLegend>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="dietType">Diet type</FieldLabel>
              <Select
                name="dietType"
                value={dietType || undefined}
                onValueChange={setDietType}
              >
                <SelectTrigger id="dietType">
                  <SelectValue placeholder="Not recorded" />
                </SelectTrigger>
                <SelectContent>
                  {DIET_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {DIET_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {dietType === "OTHER" ? (
              <Field>
                <FieldLabel htmlFor="dietTypeOther">Describe the diet</FieldLabel>
                <Input
                  id="dietTypeOther"
                  name="dietTypeOther"
                  defaultValue={assessment?.dietTypeOther ?? undefined}
                  aria-invalid={error("dietTypeOther") ? true : undefined}
                  aria-describedby={
                    error("dietTypeOther") ? "dietTypeOther-error" : undefined
                  }
                />
                <FieldError
                  id="dietTypeOther-error"
                  message={error("dietTypeOther")}
                />
              </Field>
            ) : null}
          </div>

          <Notes
            id="foodPreferences"
            label="Food preferences"
            defaultValue={assessment?.foodPreferences}
            placeholder="e.g. prefers home-cooked meals, likes seasonal fruit."
          />
          <Notes
            id="foodsDisliked"
            label="Foods disliked"
            defaultValue={assessment?.foodsDisliked}
            placeholder="e.g. does not like mushrooms."
            description="Preferences, not allergies."
          />
          <Notes
            id="foodsAvoided"
            label="Foods avoided"
            defaultValue={assessment?.foodsAvoided}
            placeholder="e.g. avoids beef on religious grounds."
          />
          <Notes
            id="dietaryRestrictions"
            label="Dietary restrictions"
            defaultValue={assessment?.dietaryRestrictions}
            placeholder="e.g. low sodium as advised by their physician."
          />
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      {/* 6 — Goals ---------------------------------------------------- */}
      <FieldSet>
        <FieldLegend>Goals</FieldLegend>
        <FieldDescription>
          What the client wants to achieve. Required to complete the assessment.
        </FieldDescription>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="primaryGoal">Primary goal</FieldLabel>
              <Select
                name="primaryGoal"
                value={primaryGoal || undefined}
                onValueChange={setPrimaryGoal}
              >
                <SelectTrigger id="primaryGoal">
                  <SelectValue placeholder="Not recorded" />
                </SelectTrigger>
                <SelectContent>
                  {PRIMARY_GOALS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PRIMARY_GOAL_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="primaryGoal-error" message={error("primaryGoal")} />
            </Field>

            {primaryGoal === "OTHER" ? (
              <Field>
                <FieldLabel htmlFor="primaryGoalOther">Describe the goal</FieldLabel>
                <Input
                  id="primaryGoalOther"
                  name="primaryGoalOther"
                  defaultValue={assessment?.primaryGoalOther ?? undefined}
                  aria-invalid={error("primaryGoalOther") ? true : undefined}
                />
                <FieldError
                  id="primaryGoalOther-error"
                  message={error("primaryGoalOther")}
                />
              </Field>
            ) : null}
          </div>

          <Notes
            id="goalNotes"
            label="Goal notes"
            defaultValue={assessment?.goalNotes}
            placeholder="Context, timeline, or what the client said in their own words."
          />
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      {/* 7 — Notes ---------------------------------------------------- */}
      <FieldSet>
        <FieldLegend>Consultation notes</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="assessmentNotes" className="sr-only">
              Consultation notes
            </FieldLabel>
            <Textarea
              id="assessmentNotes"
              name="assessmentNotes"
              rows={5}
              placeholder="Anything else relevant to this client's nutrition care."
              defaultValue={assessment?.assessmentNotes ?? undefined}
            />
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>

        <div className="flex flex-col gap-2 sm:flex-row">
          {/*
            A completed assessment has no "save draft": demoting a signed-off
            record back to draft is a workflow decision nobody has made.
          */}
          {!isCompleted ? (
            <IntentButton
              intent="draft"
              variant="outline"
              pendingLabel="Saving draft…"
            >
              <Save className="size-4" aria-hidden="true" />
              Save draft
            </IntentButton>
          ) : null}

          <IntentButton intent="complete" pendingLabel="Saving…">
            {isCompleted ? "Save changes" : "Complete assessment"}
          </IntentButton>
        </div>
      </div>
    </form>
  );
}

/**
 * A submit button carrying an intent.
 *
 * Uses `formAction`-style submission via a hidden name/value pair on the button
 * itself, so the server knows which validation to run without a second form.
 */
function IntentButton({
  intent,
  children,
  pendingLabel,
  variant,
}: {
  intent: "draft" | "complete";
  children: React.ReactNode;
  pendingLabel: string;
  variant?: "outline";
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name="intent"
      value={intent}
      variant={variant}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <Spinner className="size-4" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

function Unit({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="type-caption pointer-events-none absolute inset-y-0 right-3 flex items-center"
    >
      {children}
    </span>
  );
}

function Notes({
  id,
  label,
  defaultValue,
  placeholder,
  description,
}: {
  id: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
  description?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        name={id}
        rows={3}
        placeholder={placeholder}
        defaultValue={defaultValue ?? undefined}
        aria-describedby={description ? `${id}-hint` : undefined}
      />
      {description ? (
        <FieldDescription id={`${id}-hint`}>{description}</FieldDescription>
      ) : null}
    </Field>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

function toDateInput(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}
