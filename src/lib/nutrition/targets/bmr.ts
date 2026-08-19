/**
 * Basal metabolic rate — Mifflin-St Jeor.
 *
 * The only clinical figure this phase can calculate, and the reason is worth
 * stating: an equation with a journal citation is published knowledge, where a
 * table of requirement values is copyrighted data. Mifflin-St Jeor is named as
 * Vyom's BMR method in CLAUDE.md and its coefficients are the equation's own
 * identity, so they live in code with a citation rather than in the reference
 * table. Every *other* target needs licensed values this repository does not
 * have.
 *
 *     male    BMR = 10 × kg + 6.25 × cm − 5 × age + 5
 *     female  BMR = 10 × kg + 6.25 × cm − 5 × age − 161
 *
 * WHAT IT REFUSES TO DO
 *
 * The equation defines coefficients for two sexes and no others. A client
 * recorded as OTHER or UNDISCLOSED, or with no sex recorded at all, therefore
 * gets **no BMR** — not a male default, which is the silent substitution that
 * would make a woman's target wrong by roughly 166 kcal every day.
 *
 * POPULATION CAVEAT
 *
 * Mifflin-St Jeor was derived on a US population. It is the method this project
 * names, and the caveat travels with every result rather than being buried
 * here. An ICMR-NIN-derived equation would be preferable for Indian clients and
 * has not been acquired.
 *
 * Pure. No database, no I/O, no clock.
 */

import { Prisma } from "@/generated/prisma/browser";

import { DECIMAL_LITERAL } from "@/validations/nutrition";
import {
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/assessments/bmi";

import {
  AGE_YEARS_MAX,
  AGE_YEARS_MIN,
  unavailable,
  type ExplanationStep,
  type Target,
  type TargetInputs,
  type TargetReference,
} from "./types";

const Decimal = Prisma.Decimal;

/**
 * The published method behind every BMR figure this engine produces.
 *
 * Travels with the result. A practitioner asking "where did this come from"
 * gets the paper, not "the system calculated it".
 */
export const MIFFLIN_ST_JEOR: TargetReference = {
  kind: "PUBLICATION",
  citation:
    "Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. " +
    "A new predictive equation for resting energy expenditure in healthy individuals. " +
    "Am J Clin Nutr. 1990;51(2):241-247.",
  method: "Mifflin-St Jeor equation",
  populationCaveat:
    "Derived on a US adult population. No Indian-population resting-energy equation has been acquired, so this figure is an estimate for Indian clients rather than a population-matched one.",
};

/** Coefficients, exactly as published. Strings so they never pass through a float. */
const WEIGHT_COEFFICIENT = "10";
const HEIGHT_COEFFICIENT = "6.25";
const AGE_COEFFICIENT = "5";
const MALE_CONSTANT = "5";
const FEMALE_CONSTANT = "-161";

/**
 * Calculates resting energy expenditure in kcal/day.
 *
 * Returns an unavailable target with a specific reason for every input it
 * cannot use, rather than throwing or substituting. Each reason tells the
 * practitioner exactly which field to fill in.
 */
export function calculateBmr(inputs: TargetInputs): Target {
  if (inputs.weightKg === null) {
    return unavailable(
      "INPUT_MISSING",
      "A weight is needed to estimate resting energy. Record it on the assessment.",
    );
  }

  if (inputs.heightCm === null) {
    return unavailable(
      "INPUT_MISSING",
      "A height is needed to estimate resting energy. Record it on the assessment.",
    );
  }

  if (inputs.ageYears === null) {
    return unavailable(
      "INPUT_MISSING",
      "An age is needed to estimate resting energy. Record the client's date of birth.",
    );
  }

  if (inputs.gender === null) {
    return unavailable(
      "INPUT_MISSING",
      "A recorded sex is needed to estimate resting energy. The equation uses a different constant for female and male.",
    );
  }

  /*
   * OTHER and UNDISCLOSED are not a gap in the record — they are answers. The
   * equation simply has no coefficient set for them, and choosing one would be
   * inventing a clinical value. The honest response is that this method does
   * not cover this client.
   */
  if (inputs.gender === "OTHER" || inputs.gender === "UNDISCLOSED") {
    return unavailable(
      "POPULATION_UNSUPPORTED",
      "The Mifflin-St Jeor equation defines constants for female and male only. Resting energy cannot be estimated from it for this client, and no alternative reference has been acquired.",
    );
  }

  const weight = parseMeasurement(inputs.weightKg, WEIGHT_KG_MIN, WEIGHT_KG_MAX);
  if (!weight) {
    return unavailable(
      "INPUT_INVALID",
      "The recorded weight is outside the range this calculation accepts.",
    );
  }

  const height = parseMeasurement(inputs.heightCm, HEIGHT_CM_MIN, HEIGHT_CM_MAX);
  if (!height) {
    return unavailable(
      "INPUT_INVALID",
      "The recorded height is outside the range this calculation accepts.",
    );
  }

  if (
    !Number.isInteger(inputs.ageYears) ||
    inputs.ageYears < AGE_YEARS_MIN ||
    inputs.ageYears > AGE_YEARS_MAX
  ) {
    return unavailable(
      "INPUT_INVALID",
      "The client's date of birth gives an age this calculation cannot use.",
    );
  }

  const age = new Decimal(inputs.ageYears);
  const isFemale = inputs.gender === "FEMALE";
  const constant = new Decimal(isFemale ? FEMALE_CONSTANT : MALE_CONSTANT);

  const weightTerm = new Decimal(WEIGHT_COEFFICIENT).mul(weight);
  const heightTerm = new Decimal(HEIGHT_COEFFICIENT).mul(height);
  const ageTerm = new Decimal(AGE_COEFFICIENT).mul(age);

  const bmr = weightTerm.plus(heightTerm).minus(ageTerm).plus(constant);

  /*
   * A negative or zero result is arithmetically possible for extreme inputs and
   * is not a resting metabolic rate. Reporting it would be worse than reporting
   * nothing.
   */
  if (bmr.lessThanOrEqualTo(0)) {
    return unavailable(
      "INPUT_INVALID",
      "These measurements do not produce a usable resting energy estimate.",
    );
  }

  const explanation: ExplanationStep[] = [
    {
      label: "Method",
      detail: `Mifflin-St Jeor, ${isFemale ? "female" : "male"} constant`,
    },
    {
      label: "Weight term",
      detail: `${WEIGHT_COEFFICIENT} × ${weight.toString()} kg`,
      value: weightTerm.toString(),
      unit: "kcal",
    },
    {
      label: "Height term",
      detail: `${HEIGHT_COEFFICIENT} × ${height.toString()} cm`,
      value: heightTerm.toString(),
      unit: "kcal",
    },
    {
      label: "Age term",
      detail: `− ${AGE_COEFFICIENT} × ${age.toString()} years`,
      value: ageTerm.negated().toString(),
      unit: "kcal",
    },
    {
      label: "Sex constant",
      detail: isFemale ? FEMALE_CONSTANT : `+ ${MALE_CONSTANT}`,
      value: constant.toString(),
      unit: "kcal",
    },
    {
      label: "Resting energy",
      detail: `${weightTerm} + ${heightTerm} − ${ageTerm} ${isFemale ? "− 161" : "+ 5"}`,
      value: bmr.toString(),
      unit: "kcal/day",
    },
  ];

  return {
    status: "CALCULATED",
    kind: "POINT",
    value: bmr.toString(),
    unit: "KCAL_PER_DAY",
    valueType: "EQUATION",
    explanation,
    references: [MIFFLIN_ST_JEOR],
  };
}

/**
 * Reads a stored measurement, rejecting anything outside the bounds the
 * assessment itself enforces.
 */
function parseMeasurement(
  raw: string,
  min: number,
  max: number,
): InstanceType<typeof Prisma.Decimal> | null {
  const trimmed = raw.trim();
  if (!DECIMAL_LITERAL.test(trimmed)) return null;

  const value = new Decimal(trimmed);
  if (!value.isFinite()) return null;
  if (value.lessThan(min) || value.greaterThan(max)) return null;

  return value;
}

/**
 * Whole years between two dates.
 *
 * Both dates are parameters — the engine never reads a clock, so a target
 * calculated at 23:59 cannot differ from one calculated a minute later for a
 * reason nobody can reproduce in a test.
 *
 * Returns null for a birth date in the future or an implausible age, rather
 * than a negative number that would flow into an equation.
 */
export function ageInYears(dateOfBirth: Date, asOf: Date): number | null {
  if (Number.isNaN(dateOfBirth.getTime()) || Number.isNaN(asOf.getTime())) return null;

  let years = asOf.getUTCFullYear() - dateOfBirth.getUTCFullYear();

  const monthDelta = asOf.getUTCMonth() - dateOfBirth.getUTCMonth();
  const dayDelta = asOf.getUTCDate() - dateOfBirth.getUTCDate();

  // Birthday has not happened yet this year.
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) years -= 1;

  if (years < AGE_YEARS_MIN || years > AGE_YEARS_MAX) return null;

  return years;
}
