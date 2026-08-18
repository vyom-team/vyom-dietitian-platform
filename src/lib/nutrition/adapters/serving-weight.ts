/**
 * Recovering a serving weight from a source's own figures.
 *
 * THE PROBLEM
 *
 * INDB names a portion — "bowl", "plate", "tea cup" — but never says what it
 * weighs. A dietitian needs that weight, and Phase 8A deliberately refused to
 * invent one: an unsourced "1 cup of rice = N g" would put a fabricated number
 * underneath every calculation built on top of it.
 *
 * THE OBSERVATION
 *
 * INDB publishes every nutrient twice, per 100 g and per serving. Each pair
 * independently implies a weight:
 *
 *     grams = per_serving / per_100g × 100
 *
 * With 39 nutrient pairs per row, 39 independent estimates of the same number
 * are available. If they all agree, the source has effectively stated the
 * weight — in 39 places at once — and reading it is not a guess.
 *
 * WHY THIS IS NOT INVENTION
 *
 * The distinction that matters: a guess produces a number the source never
 * committed to, and cannot be checked. This produces a number the source
 * committed to 39 times over, and every step is reproducible from the file.
 * The agreement is recorded alongside the result, so a reviewer sees not just
 * the weight but how firmly it was implied — and a row where the nutrients
 * disagree gets **no weight at all** rather than an averaged one.
 *
 * ON FLOATING POINT
 *
 * Ratios are computed as doubles. That is acceptable here and not elsewhere:
 * this is a *derivation whose agreement is measured*, not a published value
 * being carried through. Published values still travel as strings and never
 * touch a float. The derived weight is rounded to three decimals to fit
 * NUMERIC(10,3), and the spread records how much rounding could matter.
 */

/** Below this many usable pairs, agreement means little. */
const MIN_PAIRS = 5;

/**
 * Maximum relative disagreement accepted, as a fraction.
 *
 * 0.5% allows for the rounding a publisher applies to its own printed figures
 * — a nutrient given to two decimals implies a slightly different weight than
 * one given to four — while still rejecting a row whose two halves genuinely
 * describe different quantities.
 *
 * Observed spread across the INDB release is 0.000%, so this threshold is not
 * doing quiet work: it is a guard, not a tuning knob.
 */
const MAX_SPREAD = 0.005;

/** A per-100 g figure and its per-serving counterpart, as published. */
export type NutrientPair = {
  per100: string;
  perServing: string;
};

export type ServingWeightResult =
  | { status: "derived"; grams: string; spread: string; sampleSize: number }
  | { status: "inconsistent"; spread: string; sampleSize: number }
  | { status: "insufficient"; sampleSize: number };

/**
 * Recovers the weight one serving represents.
 *
 * Returns `derived` only when every usable pair implies the same weight within
 * {@link MAX_SPREAD}. Otherwise the caller records the serving without a
 * weight, which is honest and leaves the portion name usable.
 */
export function deriveServingWeight(
  pairs: readonly NutrientPair[],
): ServingWeightResult {
  const implied: number[] = [];

  for (const pair of pairs) {
    const per100 = Number(pair.per100);
    const perServing = Number(pair.perServing);

    if (!Number.isFinite(per100) || !Number.isFinite(perServing)) continue;
    // A zero per-100 g figure implies nothing about weight: any serving size
    // multiplied by zero is still zero. Including it would divide by zero.
    if (per100 <= 0) continue;
    if (perServing < 0) continue;
    if (pair.per100.trim() === "" || pair.perServing.trim() === "") continue;

    implied.push((perServing / per100) * 100);
  }

  if (implied.length < MIN_PAIRS) {
    return { status: "insufficient", sampleSize: implied.length };
  }

  implied.sort((a, b) => a - b);
  const median = medianOf(implied);

  if (!(median > 0)) {
    return { status: "insufficient", sampleSize: implied.length };
  }

  const lowest = implied[0] ?? median;
  const highest = implied[implied.length - 1] ?? median;
  const spread = (highest - lowest) / median;

  if (spread > MAX_SPREAD) {
    return {
      status: "inconsistent",
      spread: formatSpread(spread),
      sampleSize: implied.length,
    };
  }

  return {
    status: "derived",
    // Three decimals: the precision of the NUMERIC column, and far finer than
    // any real portion is known to.
    grams: median.toFixed(3),
    spread: formatSpread(spread),
    sampleSize: implied.length,
  };
}

function medianOf(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;

  const lower = sorted[middle - 1] ?? 0;
  const upper = sorted[middle] ?? 0;
  return (lower + upper) / 2;
}

/** NUMERIC(10,8) holds eight decimals; anything finer is noise. */
function formatSpread(spread: number): string {
  return Math.min(spread, 99).toFixed(8);
}
