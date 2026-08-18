import { describe, expect, it } from "vitest";

import {
  NUTRIENT_BY_CODE,
  NUTRIENT_DEFINITIONS,
  isKnownNutrientCode,
  nutrientUnit,
} from "../src/lib/nutrition/nutrients";
import {
  SOURCE_DEFINITIONS,
  isApprovedForProduction,
  isKnownSourceCode,
} from "../src/lib/nutrition/sources";
import {
  GLOBAL_UNIT_CONVERSIONS,
  UNIT_DEFINITIONS,
  isValidBasisUnit,
} from "../src/lib/nutrition/units";

/**
 * The nutrition vocabulary.
 *
 * These tests guard properties that are cheap to break in a one-line edit and
 * expensive to discover later — a duplicated nutrient code, a licence quietly
 * marked approved, a household unit given a made-up gram weight.
 */

describe("nutrient dictionary", () => {
  it("has unique codes", () => {
    const codes = NUTRIENT_DEFINITIONS.map((nutrient) => nutrient.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every nutrient exactly one unit", () => {
    for (const nutrient of NUTRIENT_DEFINITIONS) {
      expect(nutrient.unit).toBeTruthy();
      expect(nutrientUnit(nutrient.code)).toBe(nutrient.unit);
    }
  });

  it("covers the macronutrients and the fifteen tracked micronutrients", () => {
    // The list in CLAUDE.md. A nutrient silently dropped from the dictionary
    // would make every value for it unimportable.
    for (const code of [
      "ENERGY",
      "PROTEIN",
      "FAT",
      "CARBOHYDRATE",
      "FIBRE",
      "CALCIUM",
      "IRON",
      "ZINC",
      "MAGNESIUM",
      "SODIUM",
      "POTASSIUM",
      "VITAMIN_A",
      "VITAMIN_B1",
      "VITAMIN_B2",
      "VITAMIN_B3",
      "VITAMIN_B6",
      "VITAMIN_B12",
      "VITAMIN_C",
      "VITAMIN_D",
      "FOLATE",
    ]) {
      expect(isKnownNutrientCode(code), `${code} is missing`).toBe(true);
    }
  });

  it("rejects an unknown code rather than inventing one", () => {
    expect(isKnownNutrientCode("SELENIUM_PLUS")).toBe(false);
    expect(nutrientUnit("SELENIUM_PLUS")).toBeNull();
  });

  it("contains no nutrient values", () => {
    // A dictionary describes; it does not measure. Any numeric property here
    // beyond display ordering would be a nutrition value with no source.
    for (const nutrient of NUTRIENT_DEFINITIONS) {
      const numericKeys = Object.entries(nutrient)
        .filter(([, value]) => typeof value === "number")
        .map(([key]) => key);
      expect(numericKeys).toEqual([]);
    }
  });

  it("exposes a working lookup", () => {
    expect(NUTRIENT_BY_CODE.get("PROTEIN")?.unit).toBe("G");
    expect(NUTRIENT_BY_CODE.get("VITAMIN_B12")?.unit).toBe("UG");
  });
});

describe("unit vocabulary", () => {
  it("has unique codes", () => {
    const codes = UNIT_DEFINITIONS.map((unit) => unit.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has exactly one canonical unit per category", () => {
    const canonical = UNIT_DEFINITIONS.filter((unit) => unit.isCanonical);
    const categories = canonical.map((unit) => unit.category);
    expect(new Set(categories).size).toBe(categories.length);
    expect(canonical.map((unit) => unit.code).sort()).toEqual(["g", "ml"]);
  });

  it("accepts only canonical units as a nutrition basis", () => {
    expect(isValidBasisUnit("g")).toBe(true);
    expect(isValidBasisUnit("ml")).toBe(true);
    // "Per katori" cannot be stored: nothing could later work out what a
    // katori weighs.
    expect(isValidBasisUnit("katori")).toBe(false);
    expect(isValidBasisUnit("cup")).toBe(false);
    expect(isValidBasisUnit("kg")).toBe(false);
  });

  it("marks household units as needing food context", () => {
    for (const code of ["katori", "cup", "bowl", "glass", "handful"]) {
      const unit = UNIT_DEFINITIONS.find((candidate) => candidate.code === code);
      expect(unit?.requiresFoodContext, `${code}`).toBe(true);
    }
  });

  it("defines only conversions that are unit definitions, never measurements", () => {
    // The heart of it: no invented portion weights. Only kg→g and L→ml, both
    // SI definitions, and neither involving a food.
    expect(GLOBAL_UNIT_CONVERSIONS).toHaveLength(2);

    for (const conversion of GLOBAL_UNIT_CONVERSIONS) {
      const from = UNIT_DEFINITIONS.find((unit) => unit.code === conversion.fromCode);
      const to = UNIT_DEFINITIONS.find((unit) => unit.code === conversion.toCode);

      expect(from?.category).toBe(to?.category);
      expect(from?.requiresFoodContext ?? false).toBe(false);
      expect(to?.requiresFoodContext ?? false).toBe(false);
      // Every factor says where it came from.
      expect(conversion.sourceNote.length).toBeGreaterThan(0);
    }
  });

  it("defines no gram weight for any household measure", () => {
    const householdCodes = new Set(
      UNIT_DEFINITIONS.filter((unit) => unit.requiresFoodContext).map((unit) => unit.code),
    );

    for (const conversion of GLOBAL_UNIT_CONVERSIONS) {
      expect(householdCodes.has(conversion.fromCode)).toBe(false);
      expect(householdCodes.has(conversion.toCode)).toBe(false);
    }
  });
});

describe("source registry licence posture", () => {
  it("has unique codes", () => {
    const codes = SOURCE_DEFINITIONS.map((source) => source.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("marks every source as development-only", () => {
    // No licence review has been carried out for this project. A source
    // arriving here pre-approved would be a claim nobody made.
    for (const source of SOURCE_DEFINITIONS) {
      expect(source.permissionStatus, source.code).toBe("DEVELOPMENT_ONLY");
    }
  });

  it("claims nothing about commercial use or redistribution", () => {
    for (const source of SOURCE_DEFINITIONS) {
      expect(source.commercialUseStatus, source.code).toBe("UNKNOWN");
      expect(source.redistributionStatus, source.code).toBe("UNKNOWN");
    }
  });

  it("requires attribution everywhere", () => {
    // Attributing unnecessarily is harmless; failing to attribute is not.
    for (const source of SOURCE_DEFINITIONS) {
      expect(source.attributionRequired, source.code).toBe(true);
    }
  });

  it("records what still has to be reviewed for each source", () => {
    for (const source of SOURCE_DEFINITIONS) {
      expect(source.reviewNote.length, source.code).toBeGreaterThan(20);
    }
  });

  it("registers the Indian sources the product is built around", () => {
    for (const code of ["IFCT", "INDB", "ICMR_NIN_RDA", "ICMR_NIN_DG"]) {
      expect(isKnownSourceCode(code), code).toBe(true);
    }
  });

  it("treats only an explicit approval as approval", () => {
    expect(isApprovedForProduction("APPROVED")).toBe(true);
    expect(isApprovedForProduction("DEVELOPMENT_ONLY")).toBe(false);
    expect(isApprovedForProduction("PENDING_REVIEW")).toBe(false);
    expect(isApprovedForProduction("REJECTED")).toBe(false);
  });
});
