import { describe, expect, it } from "vitest";

import {
  assessmentCompletionSchema,
  assessmentDraftSchema,
} from "../src/validations/assessment";
import { CLINICAL_ROLES, hasRole } from "../src/lib/auth/roles";

const today = new Date().toISOString().slice(0, 10);
const minimalDraft = { assessmentDate: today, assessmentType: "INITIAL" };
const minimalComplete = {
  ...minimalDraft,
  heightCm: "170",
  weightKg: "70",
  primaryGoal: "WEIGHT_LOSS",
};

describe("draft validation", () => {
  it("accepts date and type alone", () => {
    // A dietitian interrupted mid-consultation must be able to save.
    expect(assessmentDraftSchema.safeParse(minimalDraft).success).toBe(true);
  });

  it("requires an assessment date", () => {
    expect(
      assessmentDraftSchema.safeParse({ ...minimalDraft, assessmentDate: "" }).success,
    ).toBe(false);
  });

  it("requires a valid assessment type", () => {
    for (const assessmentType of ["", "SCREENING", "initial", "OTHER"]) {
      expect(
        assessmentDraftSchema.safeParse({ ...minimalDraft, assessmentType }).success,
      ).toBe(false);
    }
  });

  it("does not require measurements, health, diet, or goals", () => {
    const parsed = assessmentDraftSchema.parse(minimalDraft);
    expect(parsed.heightCm).toBeUndefined();
    expect(parsed.weightKg).toBeUndefined();
    expect(parsed.primaryGoal).toBeUndefined();
    expect(parsed.healthConditions).toBeUndefined();
  });

  /**
   * A draft may be incomplete but never wrong. Storing "-5 kg" under the draft
   * exemption would let it become permanent the moment the assessment is
   * completed.
   */
  it.each([
    ["heightCm", "-170"],
    ["heightCm", "0"],
    ["heightCm", "500"],
    ["weightKg", "-70"],
    ["weightKg", "0"],
    ["weightKg", "900"],
    ["waterLitresPerDay", "-1"],
    ["waterLitresPerDay", "50"],
  ])("still rejects an invalid %s of %s in a draft", (field, value) => {
    expect(
      assessmentDraftSchema.safeParse({ ...minimalDraft, [field]: value }).success,
    ).toBe(false);
  });

  it("treats an empty measurement as not recorded", () => {
    const parsed = assessmentDraftSchema.parse({
      ...minimalDraft,
      heightCm: "",
      weightKg: "",
      waterLitresPerDay: "",
    });
    expect(parsed.heightCm).toBeUndefined();
    expect(parsed.weightKg).toBeUndefined();
  });

  it("converts measurements to numbers", () => {
    const parsed = assessmentDraftSchema.parse({
      ...minimalDraft,
      heightCm: "170.5",
      weightKg: "70.2",
    });
    expect(parsed.heightCm).toBe(170.5);
    expect(parsed.weightKg).toBe(70.2);
  });
});

describe("assessment date", () => {
  it("rejects a future date", () => {
    // You cannot observe tomorrow's consultation.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(
      assessmentDraftSchema.safeParse({ ...minimalDraft, assessmentDate: tomorrow })
        .success,
    ).toBe(false);
  });

  it("accepts today", () => {
    expect(assessmentDraftSchema.safeParse(minimalDraft).success).toBe(true);
  });

  it("rejects an absurdly old date", () => {
    expect(
      assessmentDraftSchema.safeParse({
        ...minimalDraft,
        assessmentDate: "1990-01-01",
      }).success,
    ).toBe(false);
  });

  it.each(["not-a-date", "2026-13-01", "14/08/2026"])(
    "rejects malformed date %j",
    (assessmentDate) => {
      expect(
        assessmentDraftSchema.safeParse({ ...minimalDraft, assessmentDate }).success,
      ).toBe(false);
    },
  );
});

describe("completion validation", () => {
  it("accepts a complete assessment", () => {
    expect(assessmentCompletionSchema.safeParse(minimalComplete).success).toBe(true);
  });

  it.each(["heightCm", "weightKg"])("requires %s to complete", (field) => {
    const payload = { ...minimalComplete, [field]: "" };
    expect(assessmentCompletionSchema.safeParse(payload).success).toBe(false);
    // The same payload is a perfectly valid draft.
    expect(assessmentDraftSchema.safeParse(payload).success).toBe(true);
  });

  it("requires a primary goal to complete", () => {
    const payload = { ...minimalComplete, primaryGoal: "" };
    expect(assessmentCompletionSchema.safeParse(payload).success).toBe(false);
    expect(assessmentDraftSchema.safeParse(payload).success).toBe(true);
  });

  it("does not require health, lifestyle, diet, or notes", () => {
    // Forcing a dietitian to invent a value to get past a form is how bad data
    // enters a clinical record.
    expect(assessmentCompletionSchema.safeParse(minimalComplete).success).toBe(true);
  });

  it("names the missing field in the error path", () => {
    const result = assessmentCompletionSchema.safeParse({
      ...minimalComplete,
      heightCm: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.includes("heightCm"))).toBe(true);
  });
});

describe('"Other" requires a description', () => {
  it("rejects OTHER diet type without a description", () => {
    expect(
      assessmentDraftSchema.safeParse({ ...minimalDraft, dietType: "OTHER" }).success,
    ).toBe(false);
  });

  it("accepts OTHER diet type with a description", () => {
    expect(
      assessmentDraftSchema.safeParse({
        ...minimalDraft,
        dietType: "OTHER",
        dietTypeOther: "Jain",
      }).success,
    ).toBe(true);
  });

  it("rejects OTHER goal without a description", () => {
    expect(
      assessmentCompletionSchema.safeParse({
        ...minimalComplete,
        primaryGoal: "OTHER",
      }).success,
    ).toBe(false);
  });

  it("applies the rule to drafts too", () => {
    // A correctness rule, not a completeness rule.
    expect(
      assessmentDraftSchema.safeParse({ ...minimalDraft, primaryGoal: "OTHER" })
        .success,
    ).toBe(false);
  });
});

describe("controlled vocabularies", () => {
  it.each(["SEDENTARY", "LIGHTLY_ACTIVE", "MODERATELY_ACTIVE", "VERY_ACTIVE"])(
    "accepts activity level %s",
    (activityLevel) => {
      expect(
        assessmentDraftSchema.safeParse({ ...minimalDraft, activityLevel }).success,
      ).toBe(true);
    },
  );

  it("rejects an unknown activity level", () => {
    expect(
      assessmentDraftSchema.safeParse({ ...minimalDraft, activityLevel: "EXTREME" })
        .success,
    ).toBe(false);
  });

  it("includes eggetarian as a distinct diet type", () => {
    // A distinct category in Indian practice, not a vegetarian variant.
    expect(
      assessmentDraftSchema.safeParse({ ...minimalDraft, dietType: "EGGETARIAN" })
        .success,
    ).toBe(true);
  });
});

/**
 * The payload contract is the boundary. The fields an attacker would want are
 * not part of it.
 */
describe("assessment payload cannot carry privileged fields", () => {
  it("drops organizationId, clientId, and createdByMemberId", () => {
    const parsed = assessmentDraftSchema.parse({
      ...minimalDraft,
      organizationId: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222",
      createdByMemberId: "33333333-3333-3333-3333-333333333333",
    });
    expect(parsed).not.toHaveProperty("organizationId");
    expect(parsed).not.toHaveProperty("clientId");
    expect(parsed).not.toHaveProperty("createdByMemberId");
  });

  it("drops status and completedAt", () => {
    // Completion is decided by which button was pressed, not by the payload.
    const parsed = assessmentDraftSchema.parse({
      ...minimalDraft,
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("completedAt");
  });

  it("drops a submitted BMI", () => {
    // BMI is derived from the stored measurements; a supplied value would have
    // nowhere to go and must not be trusted.
    const parsed = assessmentDraftSchema.parse({ ...minimalDraft, bmi: 18 });
    expect(parsed).not.toHaveProperty("bmi");
  });

  it("carries no calorie, macro, or nutrient target", () => {
    // Phase 7 records observations. Deriving requirements needs reference
    // values this codebase does not have.
    const parsed = assessmentDraftSchema.parse({
      ...minimalDraft,
      calorieTarget: 1800,
      proteinGrams: 90,
      carbGrams: 200,
      fatGrams: 60,
    });
    for (const field of [
      "calorieTarget",
      "proteinGrams",
      "carbGrams",
      "fatGrams",
    ]) {
      expect(parsed, `${field} must not be accepted`).not.toHaveProperty(field);
    }
  });
});

/**
 * The clinical boundary. A receptionist may manage a client record and must
 * not read a single health field.
 */
describe("clinical role boundary", () => {
  it("admits owners and dietitians", () => {
    expect(hasRole("OWNER", CLINICAL_ROLES)).toBe(true);
    expect(hasRole("DIETITIAN", CLINICAL_ROLES)).toBe(true);
  });

  it("excludes receptionists", () => {
    expect(hasRole("RECEPTIONIST", CLINICAL_ROLES)).toBe(false);
  });

  it("excludes client-role members", () => {
    expect(hasRole("CLIENT", CLINICAL_ROLES)).toBe(false);
  });
});
