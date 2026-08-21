/**
 * Reference rule resolution — which published rule applies to this person.
 *
 * A filter and a ranking, not a chain of conditionals. Age bands, sex, and
 * physiological state are *data* on the rule, so supporting a new population is
 * a row rather than a branch, and the selection stays readable when the ICMR-NIN
 * tables land with several hundred rules.
 *
 * DETERMINISM
 *
 * The same inputs must select the same rule on every run, including when two
 * rules are equally specific. Ranking therefore ends on the rule id, so there is
 * no dependence on the order the database happened to return rows in.
 *
 * NO NEAR MISSES
 *
 * A rule that does not apply is not "close enough". If a client is 17 and every
 * protein rule starts at 18, the answer is that no reference covers them —
 * never the adult rule. Applying an adult requirement to a child is precisely
 * the kind of silent substitution this engine exists to prevent.
 *
 * Pure. No database, no I/O, no clock.
 */

import type { ClientGender, SexApplicability } from "@/generated/prisma/enums";

import type { ReferenceRuleData, TargetInputs } from "./types";

export type RuleQuery = {
  ruleType: ReferenceRuleData["ruleType"];
  /** Required for non-nutrient rules: an enum value or an equation name. */
  ruleKey?: string | null;
  /** Required for MICRONUTRIENT_INTAKE. */
  nutrientCode?: string | null;
};

/** Why no rule was selected. Distinguishes "no data" from "not for this person". */
export type RuleResolution =
  | { matched: true; rule: ReferenceRuleData }
  | { matched: false; reason: "NO_RULES_OF_TYPE" | "NO_APPLICABLE_POPULATION" };

/**
 * Maps a recorded gender onto the sexes a reference publication speaks about.
 *
 * Deliberately partial. Reference tables state values for female and male
 * populations; `OTHER` and `UNDISCLOSED` are valid answers about a person that
 * those tables simply do not address. Returning null forces the caller to
 * report that honestly instead of rounding a person into a category.
 */
export function referenceSexFor(
  gender: ClientGender | null,
): Extract<SexApplicability, "FEMALE" | "MALE"> | null {
  if (gender === "FEMALE") return "FEMALE";
  if (gender === "MALE") return "MALE";
  return null;
}

/**
 * Selects the single rule that applies, or explains why none does.
 *
 * Specificity wins: a rule written for one sex beats one written for any, and a
 * narrow age band beats a wide one. That ordering matters because reference
 * tables routinely publish a general value alongside a more specific one, and
 * the specific one is the answer.
 */
export function resolveRule(
  rules: readonly ReferenceRuleData[],
  query: RuleQuery,
  inputs: TargetInputs,
): RuleResolution {
  const ofType = rules.filter((rule) => {
    if (rule.ruleType !== query.ruleType) return false;

    if (query.nutrientCode !== undefined && query.nutrientCode !== null) {
      return rule.nutrientCode === query.nutrientCode;
    }

    if (query.ruleKey !== undefined && query.ruleKey !== null) {
      return rule.ruleKey === query.ruleKey;
    }

    return true;
  });

  if (ofType.length === 0) return { matched: false, reason: "NO_RULES_OF_TYPE" };

  const sex = referenceSexFor(inputs.gender);

  const applicable = ofType.filter((rule) => {
    /*
     * A Tolerable Upper Intake Level is a SAFETY CEILING, not a target. It is
     * the amount above which harm becomes plausible, and presenting it as
     * something to aim for would invert its meaning — iron's UL is 45 mg
     * against an RDA of 19. It is stored, because a later rules layer should be
     * able to warn when a plan approaches it, but it is never a target.
     */
    if (rule.valueType === "UL") return false;

    if (rule.physiologicalState !== inputs.physiologicalState) return false;

    /*
     * A sex-specific rule needs a mappable sex. When the client's gender does
     * not map, only an ANY rule can apply — the sex-specific ones are not
     * "probably fine", they are about a population this client was not placed
     * in.
     */
    if (rule.sexApplicability !== "ANY") {
      if (sex === null) return false;
      if (rule.sexApplicability !== sex) return false;
    }

    // An age-bounded rule cannot be applied to someone whose age is unknown.
    const isAgeBounded = rule.ageMinYears !== null || rule.ageMaxYears !== null;
    if (isAgeBounded) {
      if (inputs.ageYears === null) return false;
      if (rule.ageMinYears !== null && inputs.ageYears < rule.ageMinYears) return false;
      if (rule.ageMaxYears !== null && inputs.ageYears > rule.ageMaxYears) return false;
    }

    return true;
  });

  if (applicable.length === 0) {
    return { matched: false, reason: "NO_APPLICABLE_POPULATION" };
  }

  const ranked = [...applicable].sort((a, b) => {
    /*
     * RDA before EAR before anything else.
     *
     * ICMR-NIN recommends the EAR for population adequacy work; the RDA is the
     * figure a practitioner plans an individual against, and it is the one this
     * product shows. Both are imported and both keep their own label, so a
     * later phase can offer the choice — this only decides which is picked when
     * a caller asks for "the" target.
     */
    const byValueType = valueTypeRank(a.valueType) - valueTypeRank(b.valueType);
    if (byValueType !== 0) return byValueType;

    // Sex-specific before ANY.
    const bySex = specificity(a.sexApplicability) - specificity(b.sexApplicability);
    if (bySex !== 0) return bySex;

    // Narrower age band before wider.
    const byAge = ageSpan(a) - ageSpan(b);
    if (byAge !== 0) return byAge;

    // Nothing left to distinguish them by. The id keeps it reproducible.
    return a.id.localeCompare(b.id);
  });

  return { matched: true, rule: ranked[0]! };
}

/** Lower sorts first. UL is excluded before ranking and never appears here. */
function valueTypeRank(valueType: ReferenceRuleData["valueType"]): number {
  if (valueType === "RDA") return 0;
  if (valueType === "EAR") return 1;
  if (valueType === "AI") return 2;
  return 3;
}

/** Lower sorts first: a named sex is more specific than ANY. */
function specificity(applicability: SexApplicability): number {
  return applicability === "ANY" ? 1 : 0;
}

/**
 * How wide a rule's age band is. An unbounded side counts as the full
 * plausible lifespan, so "18 and over" loses to "19-49" as it should.
 */
function ageSpan(rule: ReferenceRuleData): number {
  const min = rule.ageMinYears ?? 0;
  const max = rule.ageMaxYears ?? 130;
  return max - min;
}
