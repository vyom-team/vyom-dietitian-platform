import { z } from "zod";

import {
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/assessments/bmi";

/**
 * Nutrition assessment schemas.
 *
 * Two schemas over the same fields:
 *
 *   `draftSchema`      — everything optional except the type. A half-finished
 *                        assessment is a legitimate state; a dietitian
 *                        interrupted mid-consultation must be able to save.
 *   `completionSchema` — adds the fields an assessment is meaningless without.
 *
 * Anything actually entered is validated in both. A draft may be *incomplete*,
 * never *wrong* — storing "-5 kg" because it was only a draft would let bad
 * data reach the record permanently once completed.
 *
 * Absent from every schema: `organizationId`, `clientId`, `createdByMemberId`,
 * `status`, `completedAt`. Those come from the session and the server.
 */

export const ASSESSMENT_TYPES = ["INITIAL", "FOLLOW_UP"] as const;
export const ACTIVITY_LEVELS = [
  "SEDENTARY",
  "LIGHTLY_ACTIVE",
  "MODERATELY_ACTIVE",
  "VERY_ACTIVE",
] as const;
export const DIET_TYPES = [
  "VEGETARIAN",
  "EGGETARIAN",
  "NON_VEGETARIAN",
  "VEGAN",
  "OTHER",
] as const;
export const PRIMARY_GOALS = [
  "WEIGHT_LOSS",
  "WEIGHT_GAIN",
  "WEIGHT_MAINTENANCE",
  "MUSCLE_GAIN",
  "GENERAL_WELLNESS",
  "CONDITION_MANAGEMENT",
  "OTHER",
] as const;

export const ASSESSMENT_TYPE_LABELS: Record<(typeof ASSESSMENT_TYPES)[number], string> = {
  INITIAL: "Initial assessment",
  FOLLOW_UP: "Follow-up",
};

export const ACTIVITY_LEVEL_LABELS: Record<(typeof ACTIVITY_LEVELS)[number], string> = {
  SEDENTARY: "Sedentary",
  LIGHTLY_ACTIVE: "Lightly active",
  MODERATELY_ACTIVE: "Moderately active",
  VERY_ACTIVE: "Very active",
};

export const ACTIVITY_LEVEL_HINTS: Record<(typeof ACTIVITY_LEVELS)[number], string> = {
  SEDENTARY: "Desk-based, little deliberate exercise",
  LIGHTLY_ACTIVE: "Light exercise 1–3 days a week",
  MODERATELY_ACTIVE: "Moderate exercise 3–5 days a week",
  VERY_ACTIVE: "Hard exercise most days, or physical work",
};

export const DIET_TYPE_LABELS: Record<(typeof DIET_TYPES)[number], string> = {
  VEGETARIAN: "Vegetarian",
  EGGETARIAN: "Eggetarian",
  NON_VEGETARIAN: "Non-vegetarian",
  VEGAN: "Vegan",
  OTHER: "Other",
};

export const PRIMARY_GOAL_LABELS: Record<(typeof PRIMARY_GOALS)[number], string> = {
  WEIGHT_LOSS: "Weight loss",
  WEIGHT_GAIN: "Weight gain",
  WEIGHT_MAINTENANCE: "Weight maintenance",
  MUSCLE_GAIN: "Muscle gain",
  GENERAL_WELLNESS: "General wellness",
  CONDITION_MANAGEMENT: "Condition management",
  OTHER: "Other",
};

// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

/**
 * A measurement from a form field.
 *
 * Comes in as a string. Empty means "not recorded" — distinct from zero, which
 * is a value and an impossible one. Bounds mirror the database CHECK
 * constraints so the two can never disagree.
 */
const measurement = (min: number, max: number, unit: string, label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value))
    .refine(
      (value) => {
        if (value === undefined) return true;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= min && parsed <= max;
      },
      { message: `Enter a ${label} between ${min} and ${max} ${unit}` },
    )
    .transform((value) => (value === undefined ? undefined : Number(value)));

const heightCm = measurement(HEIGHT_CM_MIN, HEIGHT_CM_MAX, "cm", "height");
const weightKg = measurement(WEIGHT_KG_MIN, WEIGHT_KG_MAX, "kg", "weight");
const waterLitres = measurement(0, 20, "litres", "daily water intake");

/**
 * The consultation date.
 *
 * A calendar day, not an instant. Rejects the future — an assessment records
 * what was observed, and you cannot observe tomorrow — and anything absurdly
 * far back, which catches a mistyped year.
 */
const assessmentDate = z
  .string()
  .trim()
  .min(1, "Enter the assessment date")
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return false;

      const now = new Date();
      const endOfToday = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59),
      );
      if (date.getTime() > endOfToday.getTime()) return false;

      const earliest = new Date(Date.UTC(now.getUTCFullYear() - 20, 0, 1));
      return date.getTime() >= earliest.getTime();
    },
    { message: "Enter a valid assessment date that is not in the future" },
  );

/** Fields shared by draft and completion. */
const sharedFields = {
  assessmentType: z.enum(ASSESSMENT_TYPES, { message: "Select an assessment type" }),

  heightCm,
  weightKg,

  medicalHistory: optionalText(2000),
  healthConditions: optionalText(2000),
  currentMedications: optionalText(2000),
  allergiesIntolerances: optionalText(2000),

  activityLevel: z
    .enum(ACTIVITY_LEVELS)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  exerciseFrequency: optionalText(200),
  occupation: optionalText(200),
  sleepPattern: optionalText(200),
  waterLitresPerDay: waterLitres,

  dietType: z
    .enum(DIET_TYPES)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  dietTypeOther: optionalText(120),
  foodPreferences: optionalText(2000),
  foodsDisliked: optionalText(2000),
  foodsAvoided: optionalText(2000),
  dietaryRestrictions: optionalText(2000),

  primaryGoal: z
    .enum(PRIMARY_GOALS)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  primaryGoalOther: optionalText(120),
  goalNotes: optionalText(2000),

  assessmentNotes: optionalText(4000),
};

/**
 * "Other" needs a description, or the selection carries no information.
 *
 * Applied to both schemas: this is a correctness rule about what was entered,
 * not a completeness rule, so a draft is held to it too.
 *
 * Written as a `superRefine` callback rather than a generic wrapper — wrapping
 * a `ZodTypeAny` erases the object shape and the field names stop type-checking.
 */
function checkOtherDescriptions(
  data: {
    dietType?: string | undefined;
    dietTypeOther?: string | undefined;
    primaryGoal?: string | undefined;
    primaryGoalOther?: string | undefined;
  },
  ctx: z.RefinementCtx,
) {
  if (data.dietType === "OTHER" && !data.dietTypeOther) {
    ctx.addIssue({
      code: "custom",
      message: "Describe the diet type",
      path: ["dietTypeOther"],
    });
  }

  if (data.primaryGoal === "OTHER" && !data.primaryGoalOther) {
    ctx.addIssue({
      code: "custom",
      message: "Describe the goal",
      path: ["primaryGoalOther"],
    });
  }
}

/**
 * Draft: only the date and type are required.
 *
 * Everything else may be blank, but anything present must be valid.
 */
export const assessmentDraftSchema = z
  .object({
    assessmentDate,
    ...sharedFields,
  })
  .superRefine(checkOtherDescriptions);

/**
 * Completion: adds the fields without which the record is not usable.
 *
 * Height, weight, and the primary goal are what later phases will read — a
 * "completed" assessment missing them would be a trap for the meal-planning
 * phase. Everything else stays optional because not every consultation
 * surfaces every detail, and forcing a dietitian to invent a value to get past
 * a form is how bad data enters a clinical record.
 */
export const assessmentCompletionSchema = z
  .object({
    assessmentDate,
    ...sharedFields,
    heightCm: heightCm.refine((value) => value !== undefined, {
      message: "Height is required to complete an assessment",
    }),
    weightKg: weightKg.refine((value) => value !== undefined, {
      message: "Weight is required to complete an assessment",
    }),
    primaryGoal: z.enum(PRIMARY_GOALS, {
      message: "Select a primary goal to complete this assessment",
    }),
  })
  .superRefine(checkOtherDescriptions);

export type AssessmentDraftInput = z.output<typeof assessmentDraftSchema>;
export type AssessmentDraftValues = z.input<typeof assessmentDraftSchema>;
export type AssessmentCompletionInput = z.output<typeof assessmentCompletionSchema>;

/** Identifies the assessment being acted on. Ownership is verified server-side. */
export const assessmentActionSchema = z.object({
  assessmentId: z.uuid("Invalid assessment"),
});

export const createAssessmentTargetSchema = z.object({
  clientId: z.uuid("Invalid client"),
});
