import { describe, expect, it } from "vitest";

import { getAdapter, availableAdapters, indbAdapter } from "../src/lib/nutrition/adapters";
import { deriveServingWeight } from "../src/lib/nutrition/adapters/serving-weight";
import {
  normalizeFoodName,
  normalizeSearchTerm,
  searchTokens,
} from "../src/lib/nutrition/normalize-name";
import { NUTRIENT_BY_CODE } from "../src/lib/nutrition/nutrients";

/**
 * Source adapters, name normalization, and serving-weight derivation.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. The rows below are shaped like INDB rows
 * but every number is made up, and no value is copied from any published table.
 */

/** A synthetic row in INDB's column layout. TEST FIXTURE — not real data. */
function indbRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    food_code: "SYN-1",
    food_name: "Synthetic dish (Test Name)",
    primarysource: "test_manual",
    servings_unit: "bowl",
    // per 100 g
    energy_kcal: "200",
    protein_g: "10",
    fat_g: "5",
    iron_mg: "2",
    calcium_mg: "80",
    sodium_mg: "300",
    // per serving — exactly 2× the per-100 g figures, so the serving is 200 g.
    // Six pairs, comfortably above the minimum a derivation requires: agreement
    // between two numbers would not be evidence of anything.
    unit_serving_energy_kcal: "400",
    unit_serving_protein_g: "20",
    unit_serving_fat_g: "10",
    unit_serving_iron_mg: "4",
    unit_serving_calcium_mg: "160",
    unit_serving_sodium_mg: "600",
    ...overrides,
  };
}

const HEADERS = Object.keys(indbRow());

describe("adapter registry", () => {
  it("resolves the INDB adapter, case-insensitively", () => {
    expect(getAdapter("INDB")).toBe(indbAdapter);
    expect(getAdapter("indb")).toBe(indbAdapter);
  });

  it("has no adapter for a dataset nobody has inspected", () => {
    /*
     * The principle is unchanged: writing one would mean guessing column names
     * and nutrient meanings, which is how subtly wrong nutrition gets imported.
     * USDA still has no adapter because no USDA file has been opened.
     *
     * IFCT gained one only after a real extraction was supplied and
     * cross-verified against a second independent extraction — see
     * data/nutrition/manifests/ifct-2017-tables.source.json.
     */
    expect(getAdapter("USDA_FDC")).toBeNull();
    expect(availableAdapters().sort()).toEqual(["IFCT", "INDB"]);
  });
});

describe("INDB adapter — header validation", () => {
  it("accepts a well-formed header", () => {
    const errors = indbAdapter.validateHeaders(HEADERS).filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("refuses a file with no food code", () => {
    const diagnostics = indbAdapter.validateHeaders(["food_name", "energy_kcal"]);
    expect(diagnostics.some((d) => d.code === "MISSING_COLUMN" && d.column === "food_code")).toBe(
      true,
    );
  });

  it("refuses a file with no recognised nutrient column", () => {
    // The wrong file, or a release whose layout changed. Either way it must not
    // import silently as a thousand empty records.
    const diagnostics = indbAdapter.validateHeaders(["food_code", "food_name"]);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("warns about a column it does not know, without failing", () => {
    const diagnostics = indbAdapter.validateHeaders([...HEADERS, "brand_new_nutrient_mg"]);
    const warning = diagnostics.find((d) => d.column === "brand_new_nutrient_mg");
    expect(warning?.severity).toBe("warning");
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
  });

  it("does not warn about the per-serving mirror columns", () => {
    const diagnostics = indbAdapter.validateHeaders(HEADERS);
    expect(diagnostics.some((d) => d.column?.startsWith("unit_serving_"))).toBe(false);
  });
});

describe("INDB adapter — nutrient mapping", () => {
  it("maps every column to a nutrient declared in the same unit", () => {
    // The Phase 8A rule: no unit conversion during import. That only holds if
    // each mapping already agrees with the dictionary.
    for (const mapping of indbAdapter.nutrientColumns(HEADERS)) {
      if (!mapping.nutrientCode) continue;
      const definition = NUTRIENT_BY_CODE.get(mapping.nutrientCode);
      expect(definition, mapping.sourceColumn).toBeDefined();
      expect(mapping.sourceUnit, mapping.sourceColumn).toBe(definition?.unit);
    }
  });

  it("records an unmapped column with its reason rather than dropping it", () => {
    const mappings = indbAdapter.nutrientColumns([...HEADERS, "vitb9_ug"]);
    const b9 = mappings.find((mapping) => mapping.sourceColumn === "vitb9_ug");

    expect(b9).toBeDefined();
    expect(b9?.nutrientCode).toBeNull();
    // B9 is folate, published separately. Mapping both would write one nutrient
    // twice and hide any disagreement between the two columns.
    expect(b9?.notes).toMatch(/folate/i);
  });

  it("never claims a vitamin B12 column, because INDB has none", () => {
    const mappings = indbAdapter.nutrientColumns(HEADERS);
    expect(mappings.some((mapping) => mapping.nutrientCode === "VITAMIN_B12")).toBe(false);
  });
});

describe("INDB adapter — records", () => {
  const context = { sourceCode: "INDB", version: "test" };

  it("keeps the published name and derives a searchable one", () => {
    const { records } = indbAdapter.parse([indbRow()], context);
    const record = records[0];

    expect(record?.canonicalName).toBe("Synthetic dish (Test Name)");
    // The bracketed words become findable without the published name changing.
    expect(record?.normalizedName).toBe("synthetic dish test name");
  });

  it("reads per-100 g values with an explicit basis", () => {
    const { records } = indbAdapter.parse([indbRow()], context);
    const protein = records[0]?.nutrients.find((n) => n.nutrientCode === "PROTEIN");

    expect(protein?.value).toBe("10");
    expect(protein?.unit).toBe("G");
    expect(protein?.basisQuantity).toBe("100");
    expect(protein?.basisUnitCode).toBe("g");
    // The publisher's column travels with the value, for traceability.
    expect(protein?.sourceNutrientCode).toBe("protein_g");
  });

  it("records no preparation state, because INDB publishes none", () => {
    // Most of these dishes are cooked and some are not; guessing would put a
    // fabricated distinction into a field a later engine will trust.
    const { records } = indbAdapter.parse([indbRow()], context);
    expect(records[0]?.preparationState).toBe("UNKNOWN");
  });

  it("creates no aliases", () => {
    // "(Garam Chai)" is an alternative name and "(with semolina)" is a
    // qualifier, with no reliable rule between them. Both are searchable via
    // the normalized name; neither becomes an unverified alias row.
    const { records } = indbAdapter.parse([indbRow()], context);
    expect(records[0]?.aliases).toEqual([]);
  });

  it("keeps the publisher's own sub-dataset as the external category", () => {
    const { records } = indbAdapter.parse([indbRow()], context);
    expect(records[0]?.externalCategory).toBe("test_manual");
    // INDB publishes no food group, so OTHER is the honest answer.
    expect(records[0]?.category).toBe("OTHER");
  });

  it("omits a blank nutrient rather than storing zero", () => {
    const { records, diagnostics } = indbAdapter.parse([indbRow({ iron_mg: "" })], context);

    expect(records[0]?.nutrients.some((n) => n.nutrientCode === "IRON")).toBe(false);
    expect(diagnostics.some((d) => d.code === "MISSING_NUTRIENT_VALUE")).toBe(true);
  });

  it("keeps a published zero", () => {
    const { records } = indbAdapter.parse([indbRow({ iron_mg: "0" })], context);
    const iron = records[0]?.nutrients.find((n) => n.nutrientCode === "IRON");
    expect(iron?.value).toBe("0");
  });

  it("rejects a row with no food code", () => {
    const { records, diagnostics } = indbAdapter.parse([indbRow({ food_code: "" })], context);
    expect(records).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === "MISSING_IDENTIFIER")).toBe(true);
  });

  it("reports a non-numeric value instead of skipping it quietly", () => {
    const { diagnostics } = indbAdapter.parse([indbRow({ protein_g: "about 10" })], context);
    expect(diagnostics.some((d) => d.code === "INVALID_NUMBER")).toBe(true);
  });

  it("carries values as strings so no float touches them", () => {
    const { records } = indbAdapter.parse([indbRow({ protein_g: "10.250000" })], context);
    const protein = records[0]?.nutrients.find((n) => n.nutrientCode === "PROTEIN");
    // Through a JavaScript number this becomes "10.25".
    expect(protein?.value).toBe("10.250000");
  });
});

describe("INDB adapter — servings", () => {
  const context = { sourceCode: "INDB", version: "test" };

  it("recovers the serving weight the source implied", () => {
    // Per-serving figures are exactly 2× per-100 g, so one serving is 200 g.
    const { records } = indbAdapter.parse([indbRow()], context);
    const serving = records[0]?.servings[0];

    expect(serving?.label).toBe("bowl");
    expect(serving?.weightGrams).toBe("200.000");
    expect(serving?.weightMethod).toBe("DERIVED_FROM_SOURCE");
    expect(Number(serving?.agreementSpread)).toBe(0);
  });

  it("records no serving when the source names none", () => {
    const { records } = indbAdapter.parse([indbRow({ servings_unit: "" })], context);
    expect(records[0]?.servings).toEqual([]);
  });

  it("keeps the portion name but no weight when the figures disagree", () => {
    // One nutrient implying a different serving size than the others means the
    // two halves of the row describe different quantities. Averaging them would
    // invent a weight; the honest result is a named portion with none.
    const { records, diagnostics } = indbAdapter.parse(
      [indbRow({ unit_serving_iron_mg: "40" })],
      context,
    );
    const serving = records[0]?.servings[0];

    expect(serving?.label).toBe("bowl");
    expect(serving?.weightGrams).toBeNull();
    expect(serving?.weightMethod).toBe("UNKNOWN");
    expect(diagnostics.some((d) => d.code === "SERVING_WEIGHT_INCONSISTENT")).toBe(true);
  });
});

describe("serving weight derivation", () => {
  const pair = (per100: string, perServing: string) => ({ per100, perServing });

  it("derives a weight when every pair agrees", () => {
    const result = deriveServingWeight([
      pair("100", "150"),
      pair("10", "15"),
      pair("2", "3"),
      pair("40", "60"),
      pair("8", "12"),
    ]);

    expect(result.status).toBe("derived");
    if (result.status === "derived") {
      expect(result.grams).toBe("150.000");
      expect(Number(result.spread)).toBe(0);
      expect(result.sampleSize).toBe(5);
    }
  });

  it("refuses when too few pairs are usable", () => {
    // Agreement between two numbers is not evidence of anything.
    const result = deriveServingWeight([pair("100", "150"), pair("10", "15")]);
    expect(result.status).toBe("insufficient");
  });

  it("refuses when the pairs disagree beyond tolerance", () => {
    const result = deriveServingWeight([
      pair("100", "150"),
      pair("10", "15"),
      pair("2", "3"),
      pair("40", "60"),
      // Implies 300 g rather than 150 g.
      pair("8", "24"),
    ]);
    expect(result.status).toBe("inconsistent");
  });

  it("tolerates the rounding a publisher applies to its own figures", () => {
    // A nutrient printed to two decimals implies a slightly different weight
    // than one printed to four. That is not a disagreement about the portion.
    const result = deriveServingWeight([
      pair("100", "150"),
      pair("10", "15.001"),
      pair("2", "3.0001"),
      pair("40", "59.999"),
      pair("8", "12"),
    ]);
    expect(result.status).toBe("derived");
  });

  it("ignores a zero per-100 g figure rather than dividing by it", () => {
    const result = deriveServingWeight([
      pair("0", "0"),
      pair("100", "150"),
      pair("10", "15"),
      pair("2", "3"),
      pair("40", "60"),
      pair("8", "12"),
    ]);

    expect(result.status).toBe("derived");
    if (result.status === "derived") expect(result.sampleSize).toBe(5);
  });

  it("ignores blanks and unparseable cells", () => {
    const result = deriveServingWeight([
      pair("", ""),
      pair("abc", "def"),
      pair("100", "150"),
      pair("10", "15"),
      pair("2", "3"),
      pair("40", "60"),
      pair("8", "12"),
    ]);
    expect(result.status).toBe("derived");
  });

  it("never returns a weight it could not establish", () => {
    for (const pairs of [[], [pair("0", "0")], [pair("abc", "1")]]) {
      const result = deriveServingWeight(pairs);
      expect(result.status).not.toBe("derived");
      expect(result).not.toHaveProperty("grams");
    }
  });
});

describe("food name normalization", () => {
  it("makes bracketed alternatives findable", () => {
    expect(normalizeFoodName("Plain khitchdi (Plain khichri/khichdi)")).toBe(
      "plain khitchdi plain khichri khichdi",
    );
    expect(normalizeFoodName("Hot tea (Garam Chai)")).toBe("hot tea garam chai");
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeFoodName("  Dal,   cooked;  plain  ")).toBe("dal cooked plain");
  });

  it("keeps digits and percentage signs, which carry meaning", () => {
    expect(normalizeFoodName("Milk 1.5% fat")).toBe("milk 1.5% fat");
  });

  it("preserves non-Latin scripts", () => {
    // A Latin-only filter would erase Devanagari names entirely.
    expect(normalizeFoodName("दाल")).toBe("दाल");
  });

  it("treats composed and decomposed characters as equal", () => {
    // NFC "é" and NFD "e" + combining accent must not compare as different.
    expect(normalizeFoodName("Café")).toBe(normalizeFoodName("Café"));
  });

  it("normalizes a query exactly as it normalizes a stored name", () => {
    // If these ever diverge, searches fail in ways nobody can reproduce.
    const name = "Plain khitchdi (Plain khichri/khichdi)";
    expect(normalizeFoodName(name)).toBe(normalizeSearchTerm(name));
  });

  it("drops tokens too short to narrow anything", () => {
    expect(searchTokens("a bowl of dal")).toEqual(["bowl", "of", "dal"]);
    expect(searchTokens("x")).toEqual([]);
  });

  it("produces tokens that match the normalized name", () => {
    const normalized = normalizeFoodName("Plain khitchdi (Plain khichri/khichdi)");
    for (const token of searchTokens("khichdi")) {
      expect(normalized).toContain(token);
    }
  });
});
