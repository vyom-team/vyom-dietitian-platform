import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  runReferenceImport,
  formatReferenceImportReport,
} from "../src/services/nutrition/import-references";
import { syncNutritionRegistry } from "../src/services/nutrition/registry";
import {
  parseReferenceManifest,
  validateReferenceRow,
  type ParsedReferenceRow,
} from "../src/validations/nutrition-reference";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  rlsDatabaseUrl,
  UNREACHABLE_MESSAGE,
} from "./helpers/rls-db";

/**
 * Reference-value ingestion.
 *
 * The route by which clinical requirement values enter the system, so the
 * checks that matter most are the refusals — a wrong unit or a half-imported
 * table produces targets that look authoritative and are not.
 *
 * EVERY FIGURE IN THIS FILE IS SYNTHETIC, chosen to be round and implausible so
 * it can never be mistaken for an ICMR-NIN value.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `ref${Date.now().toString(36)}`;
const VERSION = `test-${run}`;

let prisma: PrismaClient;

function manifest(overrides: Record<string, unknown> = {}) {
  const parsed = parseReferenceManifest({
    source: "ICMR_NIN_RDA",
    version: VERSION,
    file: "synthetic.csv",
    citation: "Synthetic test table, page 0 — not a published value",
    columns: {
      ruleType: "rule_type",
      nutrient: "nutrient",
      ruleKey: "rule_key",
      sex: "sex",
      ageMin: "age_min",
      ageMax: "age_max",
      value: "value",
      unit: "unit",
      valueType: "value_type",
    },
    defaults: { sex: "ANY", physiologicalState: "NONE" },
    ...overrides,
  });

  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.manifest;
}

function row(overrides: Partial<ParsedReferenceRow> = {}): ParsedReferenceRow {
  return {
    ruleType: "MICRONUTRIENT_INTAKE",
    nutrientCode: "IRON",
    ruleKey: null,
    sexApplicability: "ANY",
    ageMinYears: null,
    ageMaxYears: null,
    physiologicalState: "NONE",
    valueType: "RDA",
    value: "11",
    valueMin: null,
    valueMax: null,
    unit: "MG_PER_DAY",
    notes: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Row validation — pure, no database
// ---------------------------------------------------------------------------

describe("reference row validation", () => {
  it("accepts a well-formed micronutrient row", () => {
    expect(validateReferenceRow(row())).toEqual([]);
  });

  it("rejects a unit that disagrees with the nutrient dictionary", () => {
    /*
     * The factor-of-1000 check. Iron is stored in milligrams, so a requirement
     * declaring micrograms is a transcription error that would look entirely
     * plausible in a table and be catastrophically wrong.
     */
    const errors = validateReferenceRow(row({ unit: "UG_PER_DAY" }));

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toContain("MG_PER_DAY");
    expect(errors.join(" ")).toContain("does not convert units");
  });

  it("rejects an unknown nutrient code", () => {
    const errors = validateReferenceRow(row({ nutrientCode: "UNOBTAINIUM" }));
    expect(errors.join(" ")).toContain("Unknown nutrient");
  });

  it("requires a nutrient on a micronutrient rule", () => {
    const errors = validateReferenceRow(row({ nutrientCode: null }));
    expect(errors.join(" ")).toContain("needs a nutrient code");
  });

  it("refuses a nutrient on a non-micronutrient rule", () => {
    const errors = validateReferenceRow(
      row({ ruleType: "PROTEIN_PER_KG", unit: "G_PER_KG_PER_DAY", nutrientCode: "IRON" }),
    );
    expect(errors.join(" ")).toContain("must not carry a nutrient code");
  });

  it.each([
    ["a RANGE with only a minimum", { valueType: "RANGE", value: null, valueMin: "5" }],
    ["a RANGE with a single value", { valueType: "RANGE", value: "5", valueMin: "5", valueMax: "9" }],
    ["an RDA with no value", { value: null }],
    ["an RDA carrying a range", { value: "5", valueMin: "1", valueMax: "9" }],
    ["an EQUATION carrying a number", { valueType: "EQUATION", value: "5" }],
  ] as const)("rejects %s", (_label, overrides) => {
    const errors = validateReferenceRow(row(overrides as Partial<ParsedReferenceRow>));
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a negative requirement", () => {
    const errors = validateReferenceRow(row({ value: "-1" }));
    expect(errors.join(" ")).toContain("never below zero");
  });

  it("rejects a non-numeric value", () => {
    const errors = validateReferenceRow(row({ value: "twenty-nine" }));
    expect(errors.join(" ")).toContain("not a plain number");
  });

  it("rejects inverted age bounds", () => {
    const errors = validateReferenceRow(row({ ageMinYears: 50, ageMaxYears: 19 }));
    expect(errors.join(" ")).toContain("minimum age is greater");
  });

  it("rejects an implausible age", () => {
    expect(validateReferenceRow(row({ ageMinYears: 200 })).length).toBeGreaterThan(0);
    expect(validateReferenceRow(row({ ageMinYears: -1 })).length).toBeGreaterThan(0);
  });

  it("accepts a properly formed range", () => {
    expect(
      validateReferenceRow(
        row({
          ruleType: "FAT_ENERGY_PERCENT",
          nutrientCode: null,
          valueType: "RANGE",
          value: null,
          valueMin: "15",
          valueMax: "30",
          unit: "PERCENT_OF_ENERGY",
        }),
      ),
    ).toEqual([]);
  });
});

describe("manifest validation", () => {
  it("requires a citation", () => {
    const parsed = parseReferenceManifest({
      source: "ICMR_NIN_RDA",
      version: "2020",
      file: "x.csv",
      columns: { value: "value", unit: "unit" },
      defaults: { ruleType: "FIBRE_INTAKE", valueType: "AI" },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(" ")).toContain("citation");
  });

  it("requires a rule type from somewhere", () => {
    const parsed = parseReferenceManifest({
      source: "ICMR_NIN_RDA",
      version: "2020",
      file: "x.csv",
      citation: "table 1",
      columns: { value: "value", unit: "unit" },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(" ")).toContain("rule type");
  });

  it("never infers a unit", () => {
    const parsed = parseReferenceManifest({
      source: "ICMR_NIN_RDA",
      version: "2020",
      file: "x.csv",
      citation: "table 1",
      columns: { value: "value" },
      defaults: { ruleType: "FIBRE_INTAKE", valueType: "AI" },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(" ")).toContain("never inferred");
  });

  it("refuses a file path outside the data directory", () => {
    const parsed = parseReferenceManifest({
      source: "ICMR_NIN_RDA",
      version: "2020",
      file: "../../etc/passwd",
      citation: "table 1",
      columns: { value: "value", unit: "unit" },
      defaults: { ruleType: "FIBRE_INTAKE", valueType: "AI" },
    });

    expect(parsed.ok).toBe(false);
  });

  it("rejects an unregistered source", () => {
    const parsed = parseReferenceManifest({
      source: "MADE_UP_SOURCE",
      version: "2020",
      file: "x.csv",
      citation: "table 1",
      columns: { value: "value", unit: "unit" },
      defaults: { ruleType: "FIBRE_INTAKE", valueType: "AI" },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(" ")).toContain("Unknown source code");
  });
});

// ---------------------------------------------------------------------------
// Import against a real database
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!enabled) return;
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: rlsDatabaseUrl! }),
  });
  await syncNutritionRegistry(prisma);
}, 120_000);

afterAll(async () => {
  if (!enabled || !prisma) return;
  await prisma.referenceRule.deleteMany({
    where: { sourceVersion: { version: { startsWith: `test-${run}` } } },
  });
  await prisma.nutritionSourceVersion.deleteMany({
    where: { version: { startsWith: `test-${run}` } },
  });
  await prisma.$disconnect();
});

/** Synthetic table. Round, implausible figures — not ICMR-NIN values. */
const CSV = [
  "rule_type,nutrient,rule_key,sex,age_min,age_max,value,unit,value_type",
  "ACTIVITY_FACTOR,,SEDENTARY,ANY,,,2,FACTOR,FACTOR",
  "ACTIVITY_FACTOR,,MODERATELY_ACTIVE,ANY,,,3,FACTOR,FACTOR",
  "PROTEIN_PER_KG,,,ANY,19,130,1,G_PER_KG_PER_DAY,RDA",
  "MICRONUTRIENT_INTAKE,IRON,,FEMALE,19,49,50,MG_PER_DAY,RDA",
  "MICRONUTRIENT_INTAKE,IRON,,MALE,19,49,20,MG_PER_DAY,RDA",
  "MICRONUTRIENT_INTAKE,CALCIUM,,ANY,19,130,900,MG_PER_DAY,RDA",
  "FIBRE_INTAKE,,,ANY,,,40,G_PER_DAY,AI",
].join("\n");

describe.skipIf(!enabled)("reference import", () => {
  it("reports what it would write without writing it", async () => {
    const result = await runReferenceImport({
      prisma,
      manifest: manifest(),
      fileContents: CSV,
      dryRun: true,
    });

    expect(result.read).toBe(7);
    expect(result.failed).toBe(0);
    expect(result.created).toBe(0);
    expect(result.dryRun).toBe(true);

    const stored = await prisma.referenceRule.count({
      where: { sourceVersion: { version: VERSION } },
    });
    expect(stored).toBe(0);
  });

  it("imports every row and records the citation on each", async () => {
    const result = await runReferenceImport({
      prisma,
      manifest: manifest(),
      fileContents: CSV,
    });

    expect(result.failed).toBe(0);
    expect(result.created).toBe(7);

    const rules = await prisma.referenceRule.findMany({
      where: { sourceVersion: { version: VERSION } },
      select: { notes: true, ruleType: true },
    });

    expect(rules).toHaveLength(7);
    for (const rule of rules) {
      expect(rule.notes).toContain("Synthetic test table");
    }

    expect(result.byRuleType.map((entry) => entry.ruleType)).toContain(
      "MICRONUTRIENT_INTAKE",
    );
  });

  it("is idempotent — a second run updates rather than duplicates", async () => {
    const again = await runReferenceImport({
      prisma,
      manifest: manifest(),
      fileContents: CSV,
    });

    expect(again.created).toBe(0);
    expect(again.updated).toBe(7);

    const count = await prisma.referenceRule.count({
      where: { sourceVersion: { version: VERSION } },
    });
    expect(count).toBe(7);
  });

  it("makes the target engine resolve rules by age and sex", async () => {
    /*
     * The point of the whole exercise: once rules exist, Phase 8D stops
     * reporting REFERENCE_REQUIRED — with no change to the engine.
     */
    const rules = await prisma.referenceRule.findMany({
      where: {
        sourceVersion: { version: VERSION },
        ruleType: "MICRONUTRIENT_INTAKE",
        nutrient: { code: "IRON" },
      },
      select: { sexApplicability: true, value: true },
      orderBy: { sexApplicability: "asc" },
    });

    expect(rules).toHaveLength(2);
    const female = rules.find((rule) => rule.sexApplicability === "FEMALE");
    expect(female?.value?.toString()).toBe("50");
  });

  it("writes nothing at all when any row is invalid", async () => {
    const before = await prisma.referenceRule.count({
      where: { sourceVersion: { version: VERSION } },
    });

    const broken = [
      "rule_type,nutrient,rule_key,sex,age_min,age_max,value,unit,value_type",
      "MICRONUTRIENT_INTAKE,ZINC,,ANY,19,130,11,MG_PER_DAY,RDA",
      // Wrong unit for iron — the whole run must be refused.
      "MICRONUTRIENT_INTAKE,IRON,,ANY,19,130,29,UG_PER_DAY,RDA",
    ].join("\n");

    const result = await runReferenceImport({
      prisma,
      manifest: manifest(),
      fileContents: broken,
    });

    expect(result.failed).toBe(1);
    expect(result.created).toBe(0);
    expect(result.errors[0]!.line).toBe(3);

    // The valid zinc row was NOT written either.
    const after = await prisma.referenceRule.count({
      where: { sourceVersion: { version: VERSION } },
    });
    expect(after).toBe(before);

    const zinc = await prisma.referenceRule.count({
      where: { sourceVersion: { version: VERSION }, nutrient: { code: "ZINC" } },
    });
    expect(zinc).toBe(0);
  });

  it("reports the line number of every bad row", async () => {
    const broken = [
      "rule_type,nutrient,rule_key,sex,age_min,age_max,value,unit,value_type",
      "MICRONUTRIENT_INTAKE,IRON,,ANY,19,130,-5,MG_PER_DAY,RDA",
      "NONSENSE_RULE,,,ANY,,,1,FACTOR,FACTOR",
    ].join("\n");

    const result = await runReferenceImport({
      prisma,
      manifest: manifest(),
      fileContents: broken,
    });

    expect(result.failed).toBe(2);
    expect(result.errors.map((error) => error.line)).toEqual([2, 3]);

    const report = formatReferenceImportReport(result);
    expect(report).toContain("NOTHING WAS WRITTEN");
    expect(report).toContain("Licensing is unchanged");
  });

  it("does not clear the source for commercial use", async () => {
    /*
     * Importing values is not a licence. Only a human may change this, and the
     * importer must never do it as a side effect.
     */
    const source = await prisma.nutritionSource.findUniqueOrThrow({
      where: { code: "ICMR_NIN_RDA" },
      select: { permissionStatus: true, commercialUseStatus: true },
    });

    expect(source.permissionStatus).toBe("DEVELOPMENT_ONLY");
    expect(source.commercialUseStatus).toBe("UNKNOWN");
  });
});

describe("reference import test configuration", () => {
  it("has a reachable database", () => {
    const reason = hasRlsDatabase()
      ? UNREACHABLE_MESSAGE
      : "RLS_TEST_DATABASE_URL is not set — reference import was NOT verified.";
    expect(enabled, reason).toBe(true);
  });
});
