import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/nutrients";
import { ageInYears } from "@/lib/nutrition/targets/bmr";
import { buildTargetProfile } from "@/lib/nutrition/targets/engine";
import {
  HEADLINE_TARGET_CODES,
  type ReferenceRuleData,
  type TargetInputs,
  type TargetProfile,
} from "@/lib/nutrition/targets/types";

/**
 * Nutrition target service.
 *
 * The database half of the target engine: it loads the client, their latest
 * completed assessment, and every licensed reference rule, flattens all of it
 * into plain data, and hands that to the pure engine. It performs no clinical
 * arithmetic itself.
 *
 * SECURITY
 *
 * Unlike the food calculator, this reads **client clinical data**, so it is
 * tenant-scoped. Every query filters on the `organizationId` the caller proved
 * access to — never one supplied by the browser. The caller must have passed
 * `requireClinicalContext()` first; this module takes the resulting
 * organization id as a parameter precisely so it cannot be called without one.
 *
 * NOTHING IS PERSISTED
 *
 * Targets recalculate from the assessment on every read. A stored copy would go
 * stale the moment a measurement is corrected or a reference version is
 * imported, and there is nothing yet that needs to pin them. Immutable
 * snapshots belong to the diet-plan phase, which is the first thing that
 * genuinely has to remember "what were the targets when this plan was written".
 */

/**
 * The dictionary minus the nutrients that already have a headline target.
 *
 * Without this, energy and the macronutrients are reported twice — once as
 * their own target and again in the micronutrient list, which reads as though
 * Vyom thinks protein is a micronutrient.
 */
const MICRONUTRIENT_DEFINITIONS = NUTRIENT_DEFINITIONS.filter(
  (nutrient) =>
    !(HEADLINE_TARGET_CODES as readonly string[]).includes(nutrient.code),
);

export type TargetProfileResult =
  | { ok: true; data: TargetProfile; assessment: AssessmentSummaryForTargets }
  | {
      ok: false;
      reason: "client-not-found" | "no-assessment" | "failed";
    };

export type AssessmentSummaryForTargets = {
  id: string;
  assessmentDate: Date;
  assessmentType: string;
  status: string;
};

/**
 * Calculates nutrition targets for a client.
 *
 * @param organizationId MUST come from `requireClinicalContext()`. Never from a
 * URL, a form field, or a query parameter.
 * @param clientId the client, verified to belong to that organization
 * @param asOf the date age is computed against. A parameter rather than
 * `new Date()` so a test can pin it and so a result is reproducible.
 */
export async function getNutritionTargets(
  organizationId: string,
  clientId: string,
  asOf: Date = new Date(),
  client: PrismaClient = prisma,
): Promise<TargetProfileResult> {
  try {
    /*
     * The tenant boundary. Scoping the client lookup on organizationId means a
     * client id from another practice returns not-found rather than data —
     * there is no code path where a caller's id choice widens their access.
     */
    const person = await client.client.findFirst({
      where: { id: clientId, organizationId },
      select: {
        id: true,
        dateOfBirth: true,
        gender: true,
      },
    });

    if (!person) return { ok: false, reason: "client-not-found" };

    /*
     * The latest COMPLETED assessment. A draft is explicitly not used: it may
     * be half-filled, and calculating a clinical target from a form somebody is
     * still typing into would produce a number that changes under them.
     */
    const assessment = await client.nutritionAssessment.findFirst({
      where: { clientId, organizationId, status: "COMPLETED" },
      orderBy: [{ assessmentDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        assessmentDate: true,
        assessmentType: true,
        status: true,
        heightCm: true,
        weightKg: true,
        activityLevel: true,
        primaryGoal: true,
      },
    });

    if (!assessment) return { ok: false, reason: "no-assessment" };

    const inputs: TargetInputs = {
      ageYears: person.dateOfBirth ? ageInYears(person.dateOfBirth, asOf) : null,
      gender: person.gender,
      // Decimal → string, never a float. Same rule as every other clinical value.
      heightCm: assessment.heightCm?.toString() ?? null,
      weightKg: assessment.weightKg?.toString() ?? null,
      activityLevel: assessment.activityLevel,
      primaryGoal: assessment.primaryGoal,
      /*
       * Always NONE. The assessment model captures no physiological state, and
       * inferring pregnancy from sex or lactation from age is exactly the guess
       * this project forbids. When the field is added, this is the one line
       * that changes.
       */
      physiologicalState: "NONE",
    };

    const rules = await loadReferenceRules(client);

    return {
      ok: true,
      data: buildTargetProfile(inputs, rules, MICRONUTRIENT_DEFINITIONS),
      assessment: {
        id: assessment.id,
        assessmentDate: assessment.assessmentDate,
        assessmentType: assessment.assessmentType,
        status: assessment.status,
      },
    };
  } catch (error) {
    /*
     * Technical identifiers only. A target failure must never log a client's
     * measurements, conditions, or notes — see docs/security.md.
     */
    console.error("[targets] getNutritionTargets failed", {
      organizationId,
      clientId,
      error,
    });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Every active reference rule, flattened.
 *
 * Loaded in one query rather than per target step: the whole table is small by
 * construction — a few hundred rules once ICMR-NIN is licensed — and eight
 * separate round trips per client would be the N+1 this avoids.
 *
 * **Returns an empty array today.** `reference_rules` ships with no rows
 * because no requirement dataset has been licensed. That is the accurate state
 * of the repository, and the engine reports REFERENCE_REQUIRED rather than
 * substituting anything.
 */
async function loadReferenceRules(client: PrismaClient): Promise<ReferenceRuleData[]> {
  const rules = await client.referenceRule.findMany({
    where: { isActive: true },
    orderBy: [{ ruleType: "asc" }, { id: "asc" }],
    select: {
      id: true,
      ruleType: true,
      ruleKey: true,
      sexApplicability: true,
      ageMinYears: true,
      ageMaxYears: true,
      physiologicalState: true,
      valueType: true,
      value: true,
      valueMin: true,
      valueMax: true,
      unit: true,
      notes: true,
      nutrient: { select: { code: true } },
      sourceVersion: {
        select: {
          version: true,
          source: { select: { code: true, name: true, permissionStatus: true } },
        },
      },
    },
  });

  return rules.map((rule) => ({
    id: rule.id,
    ruleType: rule.ruleType,
    nutrientCode: rule.nutrient?.code ?? null,
    ruleKey: rule.ruleKey,
    sexApplicability: rule.sexApplicability,
    ageMinYears: rule.ageMinYears,
    ageMaxYears: rule.ageMaxYears,
    physiologicalState: rule.physiologicalState,
    valueType: rule.valueType,
    value: rule.value?.toString() ?? null,
    valueMin: rule.valueMin?.toString() ?? null,
    valueMax: rule.valueMax?.toString() ?? null,
    unit: rule.unit,
    notes: rule.notes,
    source: {
      code: rule.sourceVersion.source.code,
      name: rule.sourceVersion.source.name,
      version: rule.sourceVersion.version,
      permissionStatus: rule.sourceVersion.source.permissionStatus,
    },
  }));
}

/**
 * How many reference rules exist, by type.
 *
 * Lets a screen say plainly which parts of the engine have data behind them
 * instead of showing eight identical "unavailable" rows with no explanation of
 * whether that is a licensing gap or a bug.
 */
export async function referenceRuleCoverage(
  client: PrismaClient = prisma,
): Promise<{ ruleType: string; count: number }[]> {
  const grouped = await client.referenceRule.groupBy({
    by: ["ruleType"],
    where: { isActive: true },
    _count: { _all: true },
  });

  return grouped
    .map((entry) => ({ ruleType: entry.ruleType, count: entry._count._all }))
    .sort((a, b) => a.ruleType.localeCompare(b.ruleType));
}
