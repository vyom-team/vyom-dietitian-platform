"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireClinicalContext } from "@/lib/auth/dal";
import { createAssessment, updateAssessment } from "@/services/assessments";
import {
  assessmentCompletionSchema,
  assessmentDraftSchema,
} from "@/validations/assessment";

/**
 * Nutrition assessment Server Actions.
 *
 * `requireClinicalContext()` is the first line of every action. It resolves the
 * practice from the **session** and refuses RECEPTIONIST and CLIENT roles, so
 * neither the organization nor the permission can be influenced by the request.
 *
 * Which schema runs depends on the button pressed:
 *
 *   Save draft → `assessmentDraftSchema`      (date and type only)
 *   Complete   → `assessmentCompletionSchema` (adds height, weight, goal)
 *
 * Both validate anything that *was* entered. A draft may be incomplete, never
 * invalid — otherwise bad data slips in under the draft exemption and becomes
 * permanent the moment the assessment is completed.
 */

export type AssessmentActionState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Reads the whole assessment form. Shared by create and update. */
function assessmentFieldsFrom(formData: FormData) {
  return {
    assessmentDate: text(formData, "assessmentDate"),
    assessmentType: text(formData, "assessmentType"),

    heightCm: text(formData, "heightCm"),
    weightKg: text(formData, "weightKg"),

    medicalHistory: text(formData, "medicalHistory"),
    healthConditions: text(formData, "healthConditions"),
    currentMedications: text(formData, "currentMedications"),
    allergiesIntolerances: text(formData, "allergiesIntolerances"),

    activityLevel: text(formData, "activityLevel"),
    exerciseFrequency: text(formData, "exerciseFrequency"),
    occupation: text(formData, "occupation"),
    sleepPattern: text(formData, "sleepPattern"),
    waterLitresPerDay: text(formData, "waterLitresPerDay"),

    dietType: text(formData, "dietType"),
    dietTypeOther: text(formData, "dietTypeOther"),
    foodPreferences: text(formData, "foodPreferences"),
    foodsDisliked: text(formData, "foodsDisliked"),
    foodsAvoided: text(formData, "foodsAvoided"),
    dietaryRestrictions: text(formData, "dietaryRestrictions"),

    primaryGoal: text(formData, "primaryGoal"),
    primaryGoalOther: text(formData, "primaryGoalOther"),
    goalNotes: text(formData, "goalNotes"),

    assessmentNotes: text(formData, "assessmentNotes"),
  };
}

/** The submit button that was pressed. Anything unrecognised is treated as a draft. */
function wantsCompletion(formData: FormData): boolean {
  return text(formData, "intent") === "complete";
}

// ---------------------------------------------------------------------------

export async function createAssessmentAction(
  _previous: AssessmentActionState,
  formData: FormData,
): Promise<AssessmentActionState> {
  const { viewer } = await requireClinicalContext();

  const clientId = text(formData, "clientId");
  if (!clientId) {
    return { status: "error", message: "That client could not be found." };
  }

  const complete = wantsCompletion(formData);
  const schema = complete ? assessmentCompletionSchema : assessmentDraftSchema;
  const parsed = schema.safeParse(assessmentFieldsFrom(formData));

  if (!parsed.success) {
    return {
      status: "error",
      message: complete
        ? "Some details are needed before this assessment can be completed."
        : "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const result = await createAssessment(viewer, clientId, parsed.data, complete);

  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "client-not-found"
          ? "That client could not be found."
          : "Unable to save this assessment. Please try again.",
    };
  }

  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}/assessments/${result.data.id}`);
}

// ---------------------------------------------------------------------------

export async function updateAssessmentAction(
  _previous: AssessmentActionState,
  formData: FormData,
): Promise<AssessmentActionState> {
  const { viewer } = await requireClinicalContext();

  const assessmentId = text(formData, "assessmentId");
  const clientId = text(formData, "clientId");

  if (!assessmentId || !clientId) {
    return { status: "error", message: "That assessment could not be found." };
  }

  const complete = wantsCompletion(formData);
  const schema = complete ? assessmentCompletionSchema : assessmentDraftSchema;
  const parsed = schema.safeParse(assessmentFieldsFrom(formData));

  if (!parsed.success) {
    return {
      status: "error",
      message: complete
        ? "Some details are needed before this assessment can be completed."
        : "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const result = await updateAssessment(viewer, assessmentId, parsed.data, complete);

  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "not-found"
          ? "That assessment could not be found."
          : "Unable to save this assessment. Please try again.",
    };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/assessments/${assessmentId}`);
  redirect(`/clients/${clientId}/assessments/${assessmentId}`);
}
