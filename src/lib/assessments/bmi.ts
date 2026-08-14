/**
 * Body Mass Index.
 *
 * Derived on read, never stored: BMI is a pure function of height and weight,
 * and a stored copy silently drifts out of step the moment either is corrected.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It returns a number and nothing else. No category, no "healthy" or
 * "overweight" label, no colour, no advice. Two reasons:
 *
 *  1. Asian-Indian BMI cutoffs differ from the WHO defaults and come from the
 *     PRD, which this codebase does not have. Applying WHO thresholds to Indian
 *     clients would be actively wrong, and inventing thresholds would violate
 *     the project's prime directive: never guess a clinical number.
 *  2. Classifying a person from BMI alone is a clinical judgement. The product
 *     records data for a practitioner; it does not diagnose.
 *
 * When the cutoffs are supplied, classification belongs in its own module with
 * its own tests — not bolted on here.
 */

/** Physiologically plausible bounds, matching the database CHECK constraints. */
export const HEIGHT_CM_MIN = 30;
export const HEIGHT_CM_MAX = 260;
export const WEIGHT_KG_MIN = 1;
export const WEIGHT_KG_MAX = 500;

export type BmiResult =
  | { available: true; value: number; display: string }
  | { available: false; reason: "missing" | "invalid" };

/**
 * Calculates BMI from centimetres and kilograms.
 *
 * `BMI = weight_kg / (height_m)²`
 *
 * Returns `{ available: false }` rather than a number when it cannot be
 * computed. Never returns 0 for missing data — a displayed "0.0" reads as a
 * measurement, and a falsy number invites `bmi || "—"` to hide a real value.
 *
 * @param heightCm height in centimetres
 * @param weightKg weight in kilograms
 */
export function calculateBmi(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined,
): BmiResult {
  if (
    heightCm === null ||
    heightCm === undefined ||
    weightKg === null ||
    weightKg === undefined
  ) {
    return { available: false, reason: "missing" };
  }

  // NaN and Infinity would otherwise propagate into the division and produce a
  // nonsense figure that looks like a measurement.
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg)) {
    return { available: false, reason: "invalid" };
  }

  // Zero height is the divide-by-zero case; negatives are physically
  // meaningless. Both are rejected before any arithmetic happens.
  if (heightCm <= 0 || weightKg <= 0) {
    return { available: false, reason: "invalid" };
  }

  if (
    heightCm < HEIGHT_CM_MIN ||
    heightCm > HEIGHT_CM_MAX ||
    weightKg < WEIGHT_KG_MIN ||
    weightKg > WEIGHT_KG_MAX
  ) {
    return { available: false, reason: "invalid" };
  }

  const heightM = heightCm / 100;
  const value = weightKg / (heightM * heightM);

  if (!Number.isFinite(value)) return { available: false, reason: "invalid" };

  return {
    available: true,
    value,
    // One decimal place: the precision the input measurements justify, and how
    // BMI is conventionally reported.
    display: value.toFixed(1),
  };
}

/**
 * Parses a database Decimal (or string) into a number.
 *
 * Prisma returns `Decimal` for NUMERIC columns. `Number()` is safe here because
 * the values are bounded by CHECK constraints well inside the range where a
 * double represents one decimal place exactly.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  // `Number("")` and `Number("  ")` are both 0, which would turn "not
  // recorded" into a measurement of zero and render as "0 kg".
  const text = String(value).trim();
  if (text === "") return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
