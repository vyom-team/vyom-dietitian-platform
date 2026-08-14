import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type {
  ActivityLevel,
  AssessmentStatus,
  AssessmentType,
  DietType,
  PrimaryGoal,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/assessments/bmi";
import { seesAllClients } from "@/lib/clients/rules";
import type { Viewer } from "@/services/clients";
import type {
  AssessmentCompletionInput,
  AssessmentDraftInput,
} from "@/validations/assessment";

/**
 * Nutrition assessment service.
 *
 * SECURITY CONTRACT
 *
 *   Callers must already have passed `requireClinicalContext()`, which rejects
 *   RECEPTIONIST and CLIENT roles outright. This layer assumes the *role* is
 *   permitted and enforces the *scope*: every query carries `organizationId`,
 *   and a dietitian additionally only reaches assessments for clients assigned
 *   to them.
 *
 *   `organizationId`, `clientId`, and `createdByMemberId` are never taken from
 *   a request. The first comes from the session, the second is verified to
 *   belong to that organization before use, and the third is the caller's own
 *   membership.
 *
 * PRIVACY: every field below the measurements is health information. Nothing
 * here logs a field value; error logs carry ids only.
 */

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------

/**
 * Restricts assessments to those the viewer may read.
 *
 * A dietitian sees assessments for their own caseload — the same rule Phase 6
 * applies to clients, so the two views cannot disagree. Expressed as a Prisma
 * filter so the restriction is part of the SQL rather than applied afterwards.
 */
function scopeFor(viewer: Viewer): Prisma.NutritionAssessmentWhereInput {
  if (seesAllClients(viewer.role)) {
    return { organizationId: viewer.organizationId };
  }

  return {
    organizationId: viewer.organizationId,
    client: {
      assignments: {
        some: { organizationMemberId: viewer.membershipId, endedAt: null },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Summary for the history list. Carries no health fields. */
export type AssessmentSummary = {
  id: string;
  assessmentType: AssessmentType;
  status: AssessmentStatus;
  assessmentDate: Date;
  heightCm: number | null;
  weightKg: number | null;
  createdByName: string | null;
  completedAt: Date | null;
};

/**
 * A client's assessment history, newest first.
 *
 * Deliberately selects metadata and measurements only — no conditions,
 * medications, allergies, or notes. A list response should not carry health
 * detail that the list does not display.
 */
export async function listAssessments(
  viewer: Viewer,
  clientId: string,
  limit = 20,
): Promise<AssessmentSummary[]> {
  const rows = await prisma.nutritionAssessment.findMany({
    where: { ...scopeFor(viewer), clientId },
    orderBy: [{ assessmentDate: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      assessmentType: true,
      status: true,
      assessmentDate: true,
      heightCm: true,
      weightKg: true,
      completedAt: true,
      createdByMember: { select: { user: { select: { fullName: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    assessmentType: row.assessmentType,
    status: row.status,
    assessmentDate: row.assessmentDate,
    heightCm: toNumber(row.heightCm),
    weightKg: toNumber(row.weightKg),
    createdByName: row.createdByMember.user.fullName,
    completedAt: row.completedAt,
  }));
}

export type AssessmentDetail = AssessmentSummary & {
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  clientNumber: string;

  medicalHistory: string | null;
  healthConditions: string | null;
  currentMedications: string | null;
  allergiesIntolerances: string | null;

  activityLevel: ActivityLevel | null;
  exerciseFrequency: string | null;
  occupation: string | null;
  sleepPattern: string | null;
  waterLitresPerDay: number | null;

  dietType: DietType | null;
  dietTypeOther: string | null;
  foodPreferences: string | null;
  foodsDisliked: string | null;
  foodsAvoided: string | null;
  dietaryRestrictions: string | null;

  primaryGoal: PrimaryGoal | null;
  primaryGoalOther: string | null;
  goalNotes: string | null;

  assessmentNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * One assessment in full, or null.
 *
 * Scoped by organization and by the viewer's caseload, so an assessment
 * belonging to another practice — or to a client this dietitian is not assigned
 * to — returns null. The route renders not-found, identical to a genuinely
 * nonexistent id, so this cannot be used to discover which assessments exist.
 */
export async function getAssessment(
  viewer: Viewer,
  assessmentId: string,
): Promise<AssessmentDetail | null> {
  const row = await prisma.nutritionAssessment.findFirst({
    where: { ...scopeFor(viewer), id: assessmentId },
    include: {
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          clientNumber: true,
        },
      },
      createdByMember: { select: { user: { select: { fullName: true } } } },
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    clientId: row.client.id,
    clientFirstName: row.client.firstName,
    clientLastName: row.client.lastName,
    clientNumber: row.client.clientNumber,

    assessmentType: row.assessmentType,
    status: row.status,
    assessmentDate: row.assessmentDate,
    heightCm: toNumber(row.heightCm),
    weightKg: toNumber(row.weightKg),

    medicalHistory: row.medicalHistory,
    healthConditions: row.healthConditions,
    currentMedications: row.currentMedications,
    allergiesIntolerances: row.allergiesIntolerances,

    activityLevel: row.activityLevel,
    exerciseFrequency: row.exerciseFrequency,
    occupation: row.occupation,
    sleepPattern: row.sleepPattern,
    waterLitresPerDay: toNumber(row.waterLitresPerDay),

    dietType: row.dietType,
    dietTypeOther: row.dietTypeOther,
    foodPreferences: row.foodPreferences,
    foodsDisliked: row.foodsDisliked,
    foodsAvoided: row.foodsAvoided,
    dietaryRestrictions: row.dietaryRestrictions,

    primaryGoal: row.primaryGoal,
    primaryGoalOther: row.primaryGoalOther,
    goalNotes: row.goalNotes,

    assessmentNotes: row.assessmentNotes,
    createdByName: row.createdByMember.user.fullName,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The most recent assessment for a client, for the profile summary card. */
export async function getLatestAssessment(
  viewer: Viewer,
  clientId: string,
): Promise<AssessmentSummary | null> {
  const [latest] = await listAssessments(viewer, clientId, 1);
  return latest ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type AssessmentMutationResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; reason: "not-found" | "client-not-found" | "failed" };

/** Maps validated input to database columns. Shared by create and update. */
function toColumns(input: AssessmentDraftInput | AssessmentCompletionInput) {
  return {
    assessmentType: input.assessmentType,
    assessmentDate: new Date(`${input.assessmentDate}T00:00:00Z`),

    heightCm: input.heightCm ?? null,
    weightKg: input.weightKg ?? null,

    medicalHistory: input.medicalHistory ?? null,
    healthConditions: input.healthConditions ?? null,
    currentMedications: input.currentMedications ?? null,
    allergiesIntolerances: input.allergiesIntolerances ?? null,

    activityLevel: input.activityLevel ?? null,
    exerciseFrequency: input.exerciseFrequency ?? null,
    occupation: input.occupation ?? null,
    sleepPattern: input.sleepPattern ?? null,
    waterLitresPerDay: input.waterLitresPerDay ?? null,

    dietType: input.dietType ?? null,
    // Cleared unless the diet type is actually OTHER, so a stale description
    // cannot survive a change of selection.
    dietTypeOther: input.dietType === "OTHER" ? (input.dietTypeOther ?? null) : null,
    foodPreferences: input.foodPreferences ?? null,
    foodsDisliked: input.foodsDisliked ?? null,
    foodsAvoided: input.foodsAvoided ?? null,
    dietaryRestrictions: input.dietaryRestrictions ?? null,

    primaryGoal: input.primaryGoal ?? null,
    primaryGoalOther:
      input.primaryGoal === "OTHER" ? (input.primaryGoalOther ?? null) : null,
    goalNotes: input.goalNotes ?? null,

    assessmentNotes: input.assessmentNotes ?? null,
  };
}

/**
 * Creates an assessment for a client.
 *
 * The client is looked up **within the viewer's scope first**, so an id
 * belonging to another practice — or to a client outside a dietitian's caseload
 * — never reaches the insert. `organizationId` comes from the session and
 * `createdByMemberId` from the caller's own membership, so neither can be
 * supplied by a request.
 *
 * A database trigger independently rejects any row whose organization does not
 * match its client's and its author's.
 */
export async function createAssessment(
  viewer: Viewer,
  clientId: string,
  input: AssessmentDraftInput,
  complete: boolean,
): Promise<AssessmentMutationResult<{ id: string }>> {
  try {
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId: viewer.organizationId,
        ...(seesAllClients(viewer.role)
          ? {}
          : {
              assignments: {
                some: { organizationMemberId: viewer.membershipId, endedAt: null },
              },
            }),
      },
      select: { id: true },
    });

    if (!client) return { ok: false, reason: "client-not-found" };

    const created = await prisma.nutritionAssessment.create({
      data: {
        organizationId: viewer.organizationId,
        clientId: client.id,
        createdByMemberId: viewer.membershipId,
        status: complete ? "COMPLETED" : "DRAFT",
        completedAt: complete ? new Date() : null,
        ...toColumns(input),
      },
      select: { id: true },
    });

    return { ok: true, data: created };
  } catch (error) {
    console.error("[assessments] create failed", {
      organizationId: viewer.organizationId,
      clientId,
      error,
    });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Updates an assessment, optionally completing it.
 *
 * A completed assessment stays editable — a correction to a recorded
 * measurement should not require a new consultation record. What is never
 * allowed is a *follow-up* overwriting an earlier assessment: that is a new
 * row, which is why this only ever touches the id it was given.
 *
 * Completing is one-way here: `complete` promotes a draft, and nothing demotes
 * a completed assessment back to draft. Reopening a signed-off record is a
 * workflow decision nobody has made.
 */
export async function updateAssessment(
  viewer: Viewer,
  assessmentId: string,
  input: AssessmentDraftInput | AssessmentCompletionInput,
  complete: boolean,
): Promise<AssessmentMutationResult> {
  try {
    const existing = await prisma.nutritionAssessment.findFirst({
      where: { ...scopeFor(viewer), id: assessmentId },
      select: { id: true, status: true, completedAt: true },
    });

    if (!existing) return { ok: false, reason: "not-found" };

    const becomingComplete = complete || existing.status === "COMPLETED";

    await prisma.nutritionAssessment.update({
      where: { id: existing.id },
      data: {
        ...toColumns(input),
        status: becomingComplete ? "COMPLETED" : "DRAFT",
        // Preserve the original completion time when editing an already
        // completed assessment — it records when the consultation was signed
        // off, not when it was last touched. `updatedAt` covers that.
        completedAt: becomingComplete ? (existing.completedAt ?? new Date()) : null,
      },
    });

    return { ok: true, data: undefined };
  } catch (error) {
    console.error("[assessments] update failed", {
      organizationId: viewer.organizationId,
      assessmentId,
      error,
    });
    return { ok: false, reason: "failed" };
  }
}
