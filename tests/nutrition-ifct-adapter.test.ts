import { describe, expect, it } from "vitest";

import { ifctAdapter, readValue } from "../src/lib/nutrition/adapters/ifct";
import { getAdapter } from "../src/lib/nutrition/adapters";
import { NUTRIENT_BY_CODE } from "../src/lib/nutrition/nutrients";
import type { RawRow } from "../src/lib/nutrition/ingest/types";

/**
 * The IFCT 2017 adapter.
 *
 * Fixture rows below are shaped like the real extraction but carry **synthetic
 * figures**, deliberately round so they can never be mistaken for published
 * IFCT values. What is under test is the mapping and the refusals, not the
 * publication's numbers.
 */

const HEADERS = [
  "record_type",
  "ifct_table",
  "food_code",
  "item_name",
  "food_group",
  "regions",
  "moisture_g",
  "protein_g",
  "ash_g",
  "total_fat_g",
  "dietary_fibre_total_g",
  "carbohydrate_g",
  "energy_kj",
  "calcium_mg",
  "iron_mg",
  "selenium_ug",
  "total_folates_b9_ug",
  "retinol_ug",
  "histidine_g_per_100g_protein",
  "lead_mg",
];

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    record_type: "food",
    ifct_table: "Tables 1-11",
    food_code: "A001",
    item_name: "Synthetic grain (Testum syntheticum)",
    food_group: "Cereals and millets",
    regions: "6",
    moisture_g: "10.00",
    protein_g: "20.00",
    ash_g: "2.00",
    total_fat_g: "5.00",
    dietary_fibre_total_g: "7.00",
    carbohydrate_g: "60.00",
    energy_kj: "1500",
    calcium_mg: "100",
    iron_mg: "9.00",
    selenium_ug: "16.00",
    total_folates_b9_ug: "27.00",
    retinol_ug: "",
    histidine_g_per_100g_protein: "2.50",
    lead_mg: "0.01",
    ...overrides,
  };
}

const CONTEXT = { sourceCode: "IFCT", version: "2017" };

// ---------------------------------------------------------------------------
// Value reading
// ---------------------------------------------------------------------------

describe("reading a published cell", () => {
  it("takes the mean from a mean±SD figure", () => {
    // IFCT reports a mean and the spread across sampled regions. The mean is
    // the published value; the deviation describes the sampling.
    expect(readValue("9.20±0.40")).toBe("9.20");
    expect(readValue("1489±10")).toBe("1489");
    expect(readValue("0.001±0.000")).toBe("0.001");
  });

  it("reads a plain value unchanged", () => {
    expect(readValue("14.59")).toBe("14.59");
    expect(readValue("  181  ")).toBe("181");
  });

  it("returns null for a blank cell rather than zero", () => {
    // IFCT leaves a cell empty where it did not measure. A zero would claim
    // the food contains none of it.
    expect(readValue("")).toBeNull();
    expect(readValue("   ")).toBeNull();
    expect(readValue(undefined)).toBeNull();
  });

  it("returns null for a marker it does not understand", () => {
    expect(readValue("tr")).toBeNull();
    expect(readValue("ND")).toBeNull();
    expect(readValue("-")).toBeNull();
    expect(readValue("<0.01")).toBeNull();
  });

  it("keeps an explicit zero, which is a measurement", () => {
    expect(readValue("0")).toBe("0");
    expect(readValue("0.00")).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

describe("column mapping", () => {
  it("declares a unit for every mapped nutrient", () => {
    const mappings = ifctAdapter.nutrientColumns(HEADERS);
    const mapped = mappings.filter((entry) => entry.nutrientCode !== null);

    expect(mapped.length).toBeGreaterThan(0);
    for (const entry of mapped) {
      expect(entry.sourceUnit, `${entry.sourceColumn} has no declared unit`).toBeTruthy();
    }
  });

  it("declares a unit that matches the nutrient dictionary", () => {
    /*
     * The factor-of-1000 guard. Selenium is stored in µg and calcium in mg; a
     * mapping that disagreed would be wrong by a thousand and look entirely
     * plausible on screen.
     */
    for (const entry of ifctAdapter.nutrientColumns(HEADERS)) {
      if (!entry.nutrientCode) continue;

      const nutrient = NUTRIENT_BY_CODE.get(entry.nutrientCode);
      expect(nutrient, `${entry.nutrientCode} is not in the dictionary`).toBeDefined();
      expect(
        entry.sourceUnit,
        `${entry.sourceColumn} → ${entry.nutrientCode} declares ${entry.sourceUnit} but the dictionary says ${nutrient?.unit}`,
      ).toBe(nutrient?.unit);
    }
  });

  it("records the columns Vyom has no nutrient for, rather than dropping them", () => {
    const mappings = ifctAdapter.nutrientColumns(HEADERS);
    const unmapped = mappings.filter((entry) => entry.nutrientCode === null);

    const columns = unmapped.map((entry) => entry.sourceColumn);
    expect(columns).toContain("histidine_g_per_100g_protein");
    expect(columns).toContain("lead_mg");
    expect(columns).toContain("ash_g");

    // Each carries a reason, so the gap is explained and not merely listed.
    for (const entry of unmapped) expect(entry.notes).toBeTruthy();
  });

  it("does not map energy to kilocalories", () => {
    /*
     * IFCT publishes kilojoules only. Mapping energy_kj onto ENERGY (kcal)
     * would silently rebrand a kJ figure as a kcal one — an error of roughly
     * four times on every food in the database.
     */
    const mappings = ifctAdapter.nutrientColumns(["energy_kj"]);
    const energy = mappings.find((entry) => entry.sourceColumn === "energy_kj");

    expect(energy?.nutrientCode).toBe("ENERGY_KJ");
    expect(energy?.nutrientCode).not.toBe("ENERGY");
    expect(energy?.sourceUnit).toBe("KJ");
  });
});

describe("header validation", () => {
  it("accepts a well-formed extraction", () => {
    const errors = ifctAdapter
      .validateHeaders(HEADERS)
      .filter((entry) => entry.severity === "error");
    expect(errors).toEqual([]);
  });

  it.each(["food_code", "item_name", "food_group"])(
    "refuses a file with no %s column",
    (missing) => {
      const errors = ifctAdapter
        .validateHeaders(HEADERS.filter((header) => header !== missing))
        .filter((entry) => entry.severity === "error");

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.code).toBe("MISSING_COLUMN");
    },
  );

  it("refuses a file with no recognised nutrient column", () => {
    const errors = ifctAdapter
      .validateHeaders(["food_code", "item_name", "food_group", "something_else"])
      .filter((entry) => entry.severity === "error");

    expect(errors.length).toBeGreaterThan(0);
  });

  it("warns when a mapped column is absent rather than failing", () => {
    const diagnostics = ifctAdapter.validateHeaders(HEADERS);
    const warnings = diagnostics.filter((entry) => entry.severity === "warning");

    // The fixture omits most columns, so this must warn and not error.
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.message).toContain("missing rather than zero");
  });
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("parsing", () => {
  it("produces one record per row with its published identity", () => {
    const { records } = ifctAdapter.parse([row()], CONTEXT);

    expect(records).toHaveLength(1);
    const food = records[0]!;

    expect(food.externalId).toBe("A001");
    expect(food.canonicalName).toBe("Synthetic grain (Testum syntheticum)");
    expect(food.externalCategory).toBe("Cereals and millets");
    expect(food.category).toBe("GRAINS");
  });

  it("never guesses a preparation state", () => {
    // Raw and cooked differ in energy by roughly a factor of three, and the
    // publication does not state it per food.
    const { records } = ifctAdapter.parse([row()], CONTEXT);
    expect(records[0]!.preparationState).toBe("UNKNOWN");
  });

  it("invents no serving", () => {
    // IFCT publishes no household portion sizes.
    const { records } = ifctAdapter.parse([row()], CONTEXT);
    expect(records[0]!.servings).toEqual([]);
  });

  it("maps values with their declared units and a per-100 g basis", () => {
    const { records } = ifctAdapter.parse([row()], CONTEXT);
    const nutrients = records[0]!.nutrients;

    const find = (code: string) => nutrients.find((entry) => entry.nutrientCode === code);

    expect(find("PROTEIN")).toMatchObject({ value: "20.00", unit: "G", basisQuantity: "100" });
    expect(find("CALCIUM")).toMatchObject({ value: "100", unit: "MG" });
    expect(find("SELENIUM")).toMatchObject({ value: "16.00", unit: "UG" });
    expect(find("ENERGY_KJ")).toMatchObject({ value: "1500", unit: "KJ" });
  });

  it("omits a nutrient the source left blank — never zero", () => {
    const { records } = ifctAdapter.parse([row()], CONTEXT);
    const codes = records[0]!.nutrients.map((entry) => entry.nutrientCode);

    // retinol_ug is blank in the fixture.
    expect(codes).not.toContain("VITAMIN_A");
    expect(records[0]!.nutrients.find((e) => e.nutrientCode === "VITAMIN_A")).toBeUndefined();
  });

  it("never produces a vitamin B12 value", () => {
    // The publication has no B12 column. Absent, not zero.
    const { records } = ifctAdapter.parse([row()], CONTEXT);
    const codes = records[0]!.nutrients.map((entry) => entry.nutrientCode);
    expect(codes).not.toContain("VITAMIN_B12");
  });

  it("carries the publisher's column onto every value", () => {
    const { records } = ifctAdapter.parse([row()], CONTEXT);
    for (const nutrient of records[0]!.nutrients) {
      expect(nutrient.sourceNutrientCode).toBeTruthy();
    }
  });

  it.each([
    ["Cereals and millets", "GRAINS"],
    ["Grain legumes", "PULSES"],
    ["Green leafy vegetables", "VEGETABLES"],
    ["Marine fish", "SEAFOOD"],
    ["Edible oils and fats", "OILS"],
    ["Eggs", "EGGS"],
    ["Milk and milk products", "DAIRY"],
  ])("files %s under %s", (group, category) => {
    const { records } = ifctAdapter.parse([row({ food_group: group })], CONTEXT);
    expect(records[0]!.category).toBe(category);
  });

  it("warns rather than guessing when a food group is unmapped", () => {
    const { records, diagnostics } = ifctAdapter.parse(
      [row({ food_group: "Something Nobody Mapped" })],
      CONTEXT,
    );

    expect(records[0]!.category).toBe("OTHER");
    expect(diagnostics.some((entry) => entry.code === "UNMAPPED_CATEGORY")).toBe(true);
  });

  it("rejects a row with no identifier", () => {
    const { records, diagnostics } = ifctAdapter.parse([row({ food_code: "" })], CONTEXT);

    expect(records).toHaveLength(0);
    expect(diagnostics[0]!.severity).toBe("error");
  });

  it("warns when a row carries nothing Vyom can represent", () => {
    /*
     * The edible-oil rows are exactly this: Table 12 publishes fatty-acid
     * percentages and no proximates.
     */
    const blank = Object.fromEntries(HEADERS.map((h) => [h, ""]));
    const oil: RawRow = {
      ...blank,
      food_code: "T001",
      item_name: "Synthetic oil",
      food_group: "Edible oils and fats",
    };

    const { records, diagnostics } = ifctAdapter.parse([oil], CONTEXT);

    expect(records).toHaveLength(1);
    expect(records[0]!.nutrients).toEqual([]);
    expect(diagnostics.some((entry) => entry.code === "NO_NUTRIENT_VALUES")).toBe(true);
  });

  it("is deterministic", () => {
    const rows = [row(), row({ food_code: "A002", item_name: "Second" })];
    const runs = Array.from({ length: 10 }, () =>
      JSON.stringify(ifctAdapter.parse(rows, CONTEXT)),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe("registry", () => {
  it("is reachable by source code", () => {
    expect(getAdapter("IFCT")).toBe(ifctAdapter);
    expect(getAdapter("ifct")).toBe(ifctAdapter);
  });
});
