import { describe, expect, it } from "vitest";

import { calculateBmi, toNumber } from "../src/lib/assessments/bmi";

/**
 * BMI is the only calculation in the product so far, and it feeds a clinical
 * record — so its edge cases matter more than its happy path.
 */
describe("BMI calculation", () => {
  it("computes the documented example", () => {
    // 170 cm, 70 kg → 70 / 1.70² = 24.22…
    const result = calculateBmi(170, 70);
    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.value).toBeCloseTo(24.22, 2);
    expect(result.display).toBe("24.2");
  });

  it.each([
    [180, 81, "25.0"],
    [160, 50, "19.5"],
    [155, 45, "18.7"],
    [190, 95, "26.3"],
  ])("computes %i cm / %i kg as %s", (height, weight, expected) => {
    const result = calculateBmi(height, weight);
    expect(result.available && result.display).toBe(expected);
  });

  it("handles one decimal place in the inputs", () => {
    const result = calculateBmi(170.5, 70.2);
    expect(result.available).toBe(true);
    if (result.available) expect(result.value).toBeCloseTo(24.15, 2);
  });
});

/**
 * The spec calls these out by name. Every one must return "not available" —
 * never 0, which would render as a real measurement.
 */
describe("BMI edge cases", () => {
  it.each([
    [null, 70],
    [170, null],
    [null, null],
    [undefined, 70],
    [170, undefined],
  ])("reports missing for height=%s weight=%s", (height, weight) => {
    const result = calculateBmi(height, weight);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe("missing");
  });

  it("never divides by zero", () => {
    const result = calculateBmi(0, 70);
    expect(result.available).toBe(false);
    // The important part: no Infinity, no NaN, no crash.
    expect(JSON.stringify(result)).not.toContain("Infinity");
  });

  it.each([
    [-170, 70],
    [170, -70],
    [-170, -70],
    [0, 0],
  ])("rejects negative or zero: height=%s weight=%s", (height, weight) => {
    const result = calculateBmi(height, weight);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe("invalid");
  });

  it.each([
    [Number.NaN, 70],
    [170, Number.NaN],
    [Number.POSITIVE_INFINITY, 70],
    [170, Number.POSITIVE_INFINITY],
  ])("rejects non-finite values", (height, weight) => {
    const result = calculateBmi(height, weight);
    expect(result.available).toBe(false);
  });

  it("rejects physiologically impossible measurements", () => {
    // Mirrors the database CHECK constraints, so the two cannot disagree.
    expect(calculateBmi(25, 70).available).toBe(false);
    expect(calculateBmi(300, 70).available).toBe(false);
    expect(calculateBmi(170, 0.5).available).toBe(false);
    expect(calculateBmi(170, 600).available).toBe(false);
  });

  it("never returns zero as a value", () => {
    // A displayed "0.0" reads as a measurement, and a falsy number invites
    // `bmi || "—"` to hide a real one.
    for (const [h, w] of [[0, 70], [170, 0], [null, null]] as const) {
      const result = calculateBmi(h, w);
      expect(result.available).toBe(false);
      expect(result).not.toHaveProperty("value");
    }
  });
});

/**
 * BMI is a number, never a verdict. Asian-Indian cutoffs come from the PRD and
 * are not in this codebase; WHO defaults would be wrong for Indian clients.
 */
describe("BMI carries no clinical interpretation", () => {
  it("returns no category, label, or advice", () => {
    const result = calculateBmi(170, 70);
    expect(Object.keys(result).sort()).toEqual(["available", "display", "value"]);
  });

  it("never emits a classification word", () => {
    const serialised = JSON.stringify(calculateBmi(170, 110)).toLowerCase();
    for (const word of [
      "healthy",
      "unhealthy",
      "obese",
      "overweight",
      "underweight",
      "normal",
      "risk",
    ]) {
      expect(serialised).not.toContain(word);
    }
  });
});

describe("decimal parsing", () => {
  it("accepts numbers, numeric strings, and Decimal-like objects", () => {
    expect(toNumber(70)).toBe(70);
    expect(toNumber("70.5")).toBe(70.5);
    expect(toNumber({ toString: () => "68.4" })).toBe(68.4);
  });

  it("returns null for absent or unparseable values", () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber("")).toBeNull();
  });

  it("round-trips a one-decimal measurement exactly", () => {
    // The reason the column is NUMERIC and not double precision.
    expect(toNumber("70.1")).toBe(70.1);
    expect(String(toNumber("70.1"))).toBe("70.1");
  });
});
