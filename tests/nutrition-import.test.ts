import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { datasetManifestSchema, type DatasetManifest } from "../src/validations/nutrition";
import { runDatasetImport } from "../src/services/nutrition/import";
import {
  ensureSourceVersion,
  syncNutritionRegistry,
} from "../src/services/nutrition/registry";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  queryAs,
  rlsDatabaseUrl,
  UNREACHABLE_MESSAGE,
} from "./helpers/rls-db";

/**
 * Nutrition reference data against a real database.
 *
 * Two things are being proved here, and they pull in opposite directions:
 *
 *   1. Reference data is GLOBAL. A dietitian in one practice reads the same
 *      food rows as a dietitian in another, and that is correct.
 *   2. Nothing about (1) loosened tenant isolation. Clients and assessments
 *      remain invisible across practices, and no ordinary user can write a
 *      reference row.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. The nutrient figures are deliberately
 * implausible so they can never be mistaken for published values, and the
 * source version label is unique per run so a test can never overwrite real
 * imported data.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `nt${Date.now().toString(36)}`;
/** Namespaced so a test import cannot collide with a real IFCT 2017 import. */
const VERSION = `test-${run}`;

let prisma: PrismaClient;

/** Synthetic dataset. Not copied from IFCT, INDB, or any published table. */
const FIXTURE_CSV = [
  "code,name,group,other_names,energy,protein,iron",
  "SYN-1,Synthetic Food One,Pulses,Alpha Name;Beta Name,11111,22.250000,3.5",
  "SYN-2,Synthetic Food Two,Millets,,22222,0,",
  "SYN-3,Synthetic Food Three,Pulses,,33333,11.1,0.75",
].join("\n");

function fixtureManifest(overrides: Record<string, unknown> = {}): DatasetManifest {
  return datasetManifestSchema.parse({
    source: "IFCT",
    version: VERSION,
    file: "synthetic.csv",
    identifierColumn: "code",
    nameColumn: "name",
    categoryColumn: "group",
    categoryMap: { Pulses: "PULSES" },
    defaultCategory: "OTHER",
    aliasColumns: [{ column: "other_names", separator: ";" }],
    nutrients: [
      { column: "energy", nutrient: "ENERGY", unit: "KCAL" },
      { column: "protein", nutrient: "PROTEIN", unit: "G" },
      { column: "iron", nutrient: "IRON", unit: "MG" },
    ],
    ...overrides,
  });
}

function importFixture(contents = FIXTURE_CSV, overrides = {}) {
  return runDatasetImport({
    prisma,
    manifest: fixtureManifest(overrides),
    contents,
    fileName: "synthetic.csv",
  });
}

async function makeAuthUser(suffix: string) {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO auth.users (id, email, raw_user_meta_data, created_at)
     VALUES (gen_random_uuid(), $1, jsonb_build_object('full_name', $2::text), now())
     RETURNING id`,
    `${run}-${suffix}@vyom.test`,
    `Staff ${suffix}`,
  );
  const authId = rows[0]!.id;
  const profile = await prisma.userProfile.findUniqueOrThrow({
    where: { authUserId: authId },
    select: { id: true },
  });
  return { authId, profileId: profile.id };
}

type Practice = {
  orgId: string;
  ownerAuthId: string;
  dietitianAuthId: string;
  receptionistAuthId: string;
};

async function makePractice(key: string): Promise<Practice> {
  const owner = await makeAuthUser(`${key}-owner`);
  const dietitian = await makeAuthUser(`${key}-diet`);
  const receptionist = await makeAuthUser(`${key}-recep`);

  const org = await prisma.organization.create({
    data: { name: `${run} ${key}`, slug: `${run}-${key}` },
    select: { id: true },
  });

  for (const [profileId, role] of [
    [owner.profileId, "OWNER"],
    [dietitian.profileId, "DIETITIAN"],
    [receptionist.profileId, "RECEPTIONIST"],
  ] as const) {
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: profileId, role, status: "ACTIVE" },
    });
  }

  return {
    orgId: org.id,
    ownerAuthId: owner.authId,
    dietitianAuthId: dietitian.authId,
    receptionistAuthId: receptionist.authId,
  };
}

let practiceA: Practice;
let practiceB: Practice;
let versionId: string;

beforeAll(async () => {
  if (!enabled) return;

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: rlsDatabaseUrl! }),
  });

  await syncNutritionRegistry(prisma);
  const version = await ensureSourceVersion(prisma, "IFCT", VERSION);
  versionId = version.id;

  practiceA = await makePractice("a");
  practiceB = await makePractice("b");
}, 120_000);

afterAll(async () => {
  if (!enabled || !prisma) return;

  // Remove only this run's rows. The shared vocabulary stays: it is idempotent
  // and other suites may be using it.
  await prisma.foodNutrient.deleteMany({ where: { sourceVersionId: versionId } });
  await prisma.sourceFood.deleteMany({ where: { sourceVersionId: versionId } });
  await prisma.foodAlias.deleteMany({
    where: { food: { originSourceVersionId: versionId } },
  });
  await prisma.food.deleteMany({ where: { originSourceVersionId: versionId } });
  await prisma.datasetImport.deleteMany({ where: { sourceVersionId: versionId } });
  await prisma.nutritionSourceVersion.deleteMany({ where: { version: VERSION } });

  await prisma.organizationMember.deleteMany({
    where: { organizationId: { in: [practiceA.orgId, practiceB.orgId] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [practiceA.orgId, practiceB.orgId] } },
  });
  await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE email LIKE '${run}-%'`);

  await prisma.$disconnect();
});

describe.skipIf(!enabled)("nutrition registry", () => {
  it("registers sources without granting any of them clearance", async () => {
    const sources = await prisma.nutritionSource.findMany({
      select: { code: true, permissionStatus: true, commercialUseStatus: true },
    });

    expect(sources.length).toBeGreaterThanOrEqual(5);
    for (const source of sources) {
      expect(source.permissionStatus, source.code).toBe("DEVELOPMENT_ONLY");
      expect(source.commercialUseStatus, source.code).toBe("UNKNOWN");
    }
  });

  it("is idempotent", async () => {
    const before = await prisma.nutrient.count();
    await syncNutritionRegistry(prisma);
    expect(await prisma.nutrient.count()).toBe(before);
  });

  it("never resets a recorded licence decision", async () => {
    // A human review that recorded APPROVED must survive a re-sync — otherwise
    // the sync silently reverts a legal determination.
    const source = await prisma.nutritionSource.findUniqueOrThrow({
      where: { code: "USDA_FDC" },
      select: { id: true },
    });
    await prisma.nutritionSource.update({
      where: { id: source.id },
      data: { permissionStatus: "PENDING_REVIEW" },
    });

    await syncNutritionRegistry(prisma);

    const after = await prisma.nutritionSource.findUniqueOrThrow({
      where: { id: source.id },
      select: { permissionStatus: true },
    });
    expect(after.permissionStatus).toBe("PENDING_REVIEW");

    await prisma.nutritionSource.update({
      where: { id: source.id },
      data: { permissionStatus: "DEVELOPMENT_ONLY" },
    });
  });

  it("seeds no food-specific unit conversion", async () => {
    // A household portion weight with no published reference would be an
    // invented number underneath every future calculation.
    expect(await prisma.unitConversion.count({ where: { foodId: { not: null } } })).toBe(0);
  });

  it("seeds exactly one canonical unit per category", async () => {
    const canonical = await prisma.unit.findMany({
      where: { isCanonical: true },
      select: { code: true, category: true },
    });
    const categories = canonical.map((unit) => unit.category);
    expect(new Set(categories).size).toBe(categories.length);
  });
});

describe.skipIf(!enabled)("dataset import", () => {
  it("imports records and reports counts that match the database", async () => {
    const result = await importFixture();

    expect(result.statistics.recordsRead).toBe(3);
    expect(result.statistics.recordsValid).toBe(3);
    expect(result.statistics.foodsCreated).toBe(3);

    const foods = await prisma.food.count({ where: { originSourceVersionId: versionId } });
    // The report is only worth having if it agrees with reality.
    expect(foods).toBe(result.statistics.recordsImported);
  });

  it("preserves provenance on every value", async () => {
    const value = await prisma.foodNutrient.findFirstOrThrow({
      where: { sourceVersionId: versionId },
      select: {
        sourceVersionId: true,
        basisQuantity: true,
        basisUnitCode: true,
        sourceVersion: { select: { version: true, source: { select: { code: true } } } },
      },
    });

    expect(value.sourceVersion.source.code).toBe("IFCT");
    expect(value.sourceVersion.version).toBe(VERSION);
    expect(value.basisQuantity.toString()).toBe("100");
    expect(value.basisUnitCode).toBe("g");
  });

  it("keeps the publisher's identifier and the original row", async () => {
    const sourceFood = await prisma.sourceFood.findFirstOrThrow({
      where: { sourceVersionId: versionId, externalId: "SYN-1" },
    });

    expect(sourceFood.externalName).toBe("Synthetic Food One");
    expect(sourceFood.externalCategory).toBe("Pulses");
    expect(sourceFood.mappingStatus).toBe("MAPPED");
    expect(sourceFood.foodId).not.toBeNull();
    // The audit trail: whatever normalisation gets wrong can be recovered.
    expect(sourceFood.rawPayload).toMatchObject({ code: "SYN-1" });
  });

  it("stores a decimal value without floating-point drift", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-1" },
      select: { id: true },
    });
    const protein = await prisma.nutrient.findUniqueOrThrow({ where: { code: "PROTEIN" } });

    const value = await prisma.foodNutrient.findFirstOrThrow({
      where: { foodId: food.id, nutrientId: protein.id, sourceVersionId: versionId },
      select: { value: true },
    });

    // The reason the column is NUMERIC: 22.25 must round-trip exactly.
    expect(Number(value.value)).toBe(22.25);
  });

  it("writes no row for a value the source left blank", async () => {
    // SYN-2 has no iron figure. The absence must be an absent row, not a zero.
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-2" },
      select: { id: true },
    });
    const iron = await prisma.nutrient.findUniqueOrThrow({ where: { code: "IRON" } });

    const value = await prisma.foodNutrient.findFirst({
      where: { foodId: food.id, nutrientId: iron.id },
    });
    expect(value).toBeNull();
  });

  it("keeps a published zero, which is a different fact", async () => {
    // SYN-2 publishes protein as 0 — measured and found none.
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-2" },
      select: { id: true },
    });
    const protein = await prisma.nutrient.findUniqueOrThrow({ where: { code: "PROTEIN" } });

    const value = await prisma.foodNutrient.findFirstOrThrow({
      where: { foodId: food.id, nutrientId: protein.id },
      select: { value: true },
    });
    expect(Number(value.value)).toBe(0);
  });

  it("imports aliases", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-1" },
      select: { id: true },
    });
    const aliases = await prisma.foodAlias.findMany({
      where: { foodId: food.id },
      select: { alias: true },
      orderBy: { alias: "asc" },
    });
    expect(aliases.map((a) => a.alias)).toEqual(["Alpha Name", "Beta Name"]);
  });

  it("records an unmapped category without losing the publisher's wording", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-2" },
      select: { category: true },
    });
    expect(food.category).toBe("OTHER");

    const sourceFood = await prisma.sourceFood.findFirstOrThrow({
      where: { sourceVersionId: versionId, externalId: "SYN-2" },
      select: { externalCategory: true },
    });
    expect(sourceFood.externalCategory).toBe("Millets");
  });

  it("writes a manifest for the run", async () => {
    const record = await prisma.datasetImport.findFirstOrThrow({
      where: { sourceVersionId: versionId },
      orderBy: { startedAt: "desc" },
    });

    expect(record.status).not.toBe("RUNNING");
    expect(record.completedAt).not.toBeNull();
    expect(record.inputFile).toBe("synthetic.csv");
    expect(record.inputChecksum).toMatch(/^[a-f0-9]{64}$/);
    // A file name, never a path — a full path leaks the machine's layout.
    expect(record.inputFile).not.toContain("/");
    expect(record.inputFile).not.toContain("\\");
  });

  it("marks the version as imported", async () => {
    const version = await prisma.nutritionSourceVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { importedAt: true },
    });
    expect(version.importedAt).not.toBeNull();
  });
});

describe.skipIf(!enabled)("idempotence", () => {
  it("running the same import twice does not duplicate anything", async () => {
    const before = {
      foods: await prisma.food.count({ where: { originSourceVersionId: versionId } }),
      values: await prisma.foodNutrient.count({ where: { sourceVersionId: versionId } }),
      aliases: await prisma.foodAlias.count({
        where: { food: { originSourceVersionId: versionId } },
      }),
      mappings: await prisma.sourceFood.count({ where: { sourceVersionId: versionId } }),
    };

    const result = await importFixture();

    expect(await prisma.food.count({ where: { originSourceVersionId: versionId } })).toBe(
      before.foods,
    );
    expect(
      await prisma.foodNutrient.count({ where: { sourceVersionId: versionId } }),
    ).toBe(before.values);
    expect(
      await prisma.foodAlias.count({
        where: { food: { originSourceVersionId: versionId } },
      }),
    ).toBe(before.aliases);
    expect(
      await prisma.sourceFood.count({ where: { sourceVersionId: versionId } }),
    ).toBe(before.mappings);

    // Matched, not created — the signal that the key actually worked.
    expect(result.statistics.foodsCreated).toBe(0);
    expect(result.statistics.foodsUpdated).toBe(3);
  });

  it("a corrected value updates in place rather than accumulating", async () => {
    const corrected = FIXTURE_CSV.replace("22.250000", "22.500000");
    await importFixture(corrected);

    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-1" },
      select: { id: true },
    });
    const protein = await prisma.nutrient.findUniqueOrThrow({ where: { code: "PROTEIN" } });

    const values = await prisma.foodNutrient.findMany({
      where: { foodId: food.id, nutrientId: protein.id, sourceVersionId: versionId },
    });

    expect(values).toHaveLength(1);
    expect(Number(values[0]!.value)).toBe(22.5);

    await importFixture();
  });

  it("skips a repeated identifier within one file instead of overwriting", async () => {
    const duplicated = `${FIXTURE_CSV}\nSYN-1,Synthetic Food One Again,Pulses,,44444,1,1`;
    const result = await importFixture(duplicated);

    expect(result.statistics.duplicateIdentifiers).toBe(1);
    expect(result.statistics.recordsSkipped).toBe(1);
    expect(result.diagnostics.some((d) => d.code === "DUPLICATE_IDENTIFIER")).toBe(true);

    // The first row wins, so the import is not order-dependent.
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-1" },
      select: { canonicalName: true },
    });
    expect(food.canonicalName).toBe("Synthetic Food One");
  });
});

describe.skipIf(!enabled)("dataset versioning", () => {
  it("a second release adds values without disturbing the first", async () => {
    const laterVersion = `${VERSION}-next`;
    const later = await ensureSourceVersion(prisma, "IFCT", laterVersion);

    try {
      await runDatasetImport({
        prisma,
        manifest: fixtureManifest({ version: laterVersion }),
        contents: FIXTURE_CSV.replace("11111", "99999"),
        fileName: "synthetic.csv",
      });

      // Both releases coexist. The original figure is untouched and still
      // attributed to the release that published it.
      const originalFood = await prisma.food.findFirstOrThrow({
        where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-1" },
        select: { id: true },
      });
      const energy = await prisma.nutrient.findUniqueOrThrow({ where: { code: "ENERGY" } });

      const original = await prisma.foodNutrient.findFirstOrThrow({
        where: { foodId: originalFood.id, nutrientId: energy.id, sourceVersionId: versionId },
        select: { value: true },
      });
      expect(Number(original.value)).toBe(11111);

      const revised = await prisma.foodNutrient.findFirstOrThrow({
        where: { nutrientId: energy.id, sourceVersionId: later.id },
        select: { value: true },
      });
      expect(Number(revised.value)).toBe(99999);
    } finally {
      await prisma.foodNutrient.deleteMany({ where: { sourceVersionId: later.id } });
      await prisma.sourceFood.deleteMany({ where: { sourceVersionId: later.id } });
      await prisma.foodAlias.deleteMany({
        where: { food: { originSourceVersionId: later.id } },
      });
      await prisma.food.deleteMany({ where: { originSourceVersionId: later.id } });
      await prisma.datasetImport.deleteMany({ where: { sourceVersionId: later.id } });
      await prisma.nutritionSourceVersion.delete({ where: { id: later.id } });
    }
  });
});

describe.skipIf(!enabled)("import failure reporting", () => {
  it("fails the run when a declared column is absent, without writing rows", async () => {
    const before = await prisma.food.count({ where: { originSourceVersionId: versionId } });

    const result = await runDatasetImport({
      prisma,
      manifest: fixtureManifest({
        nutrients: [{ column: "not_a_column", nutrient: "ENERGY", unit: "KCAL" }],
      }),
      contents: FIXTURE_CSV,
      fileName: "synthetic.csv",
    });

    expect(result.status).toBe("FAILED");
    expect(result.diagnostics.some((d) => d.code === "MISSING_COLUMN")).toBe(true);
    // A manifest error must not import a dataset full of gaps.
    expect(await prisma.food.count({ where: { originSourceVersionId: versionId } })).toBe(
      before,
    );
  });

  it("reports PARTIAL when some rows fail and imports the rest", async () => {
    const withBadRow = `${FIXTURE_CSV}\nSYN-4,Synthetic Food Four,Pulses,,not-a-number,1,1`;
    const result = await importFixture(withBadRow);

    expect(result.status).toBe("PARTIAL");
    expect(result.statistics.nutrientValuesInvalid).toBeGreaterThan(0);

    // The good rows still landed.
    const food = await prisma.food.findFirst({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-4" },
      select: { id: true },
    });
    expect(food).not.toBeNull();

    await prisma.foodNutrient.deleteMany({ where: { food: { originSourceFoodId: "SYN-4" } } });
    await prisma.sourceFood.deleteMany({
      where: { sourceVersionId: versionId, externalId: "SYN-4" },
    });
    await prisma.food.deleteMany({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-4" },
    });
  });

  it("a dry run writes a manifest and nothing else", async () => {
    const foodsBefore = await prisma.food.count({
      where: { originSourceVersionId: versionId },
    });

    const result = await runDatasetImport({
      prisma,
      manifest: fixtureManifest(),
      contents: `${FIXTURE_CSV}\nSYN-9,Never Written,Pulses,,1,1,1`,
      fileName: "synthetic.csv",
      dryRun: true,
    });

    expect(result.statistics.recordsValid).toBe(4);
    expect(await prisma.food.count({ where: { originSourceVersionId: versionId } })).toBe(
      foodsBefore,
    );

    const record = await prisma.datasetImport.findUniqueOrThrow({
      where: { id: result.importId },
      select: { dryRun: true },
    });
    expect(record.dryRun).toBe(true);
  });
});

describe.skipIf(!enabled)("database constraints", () => {
  it("refuses a negative nutrient value", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId },
      select: { id: true },
    });
    const nutrient = await prisma.nutrient.findUniqueOrThrow({ where: { code: "ZINC" } });

    await expect(
      prisma.foodNutrient.create({
        data: {
          foodId: food.id,
          nutrientId: nutrient.id,
          sourceVersionId: versionId,
          value: "-1",
          unit: "MG",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a zero basis, which would make every derived quantity undefined", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId },
      select: { id: true },
    });
    const nutrient = await prisma.nutrient.findUniqueOrThrow({ where: { code: "SODIUM" } });

    await expect(
      prisma.foodNutrient.create({
        data: {
          foodId: food.id,
          nutrientId: nutrient.id,
          sourceVersionId: versionId,
          value: "1",
          unit: "MG",
          basisQuantity: "0",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a blank canonical name", async () => {
    await expect(
      prisma.food.create({
        data: { canonicalName: "   ", category: "OTHER", foodType: "RAW" },
      }),
    ).rejects.toThrow();
  });

  it("refuses half a provenance trail", async () => {
    // Half a trail is worse than none, because it looks like a trail.
    await expect(
      prisma.food.create({
        data: {
          canonicalName: `${run} orphan`,
          category: "OTHER",
          foodType: "RAW",
          originSourceFoodId: "X1",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a MAPPED source record with no food", async () => {
    await expect(
      prisma.sourceFood.create({
        data: {
          sourceVersionId: versionId,
          externalId: `${run}-bad`,
          externalName: "Bad mapping",
          mappingStatus: "MAPPED",
        },
      }),
    ).rejects.toThrow();
  });

  it("allows an unmapped source record, which is an honest state", async () => {
    const created = await prisma.sourceFood.create({
      data: {
        sourceVersionId: versionId,
        externalId: `${run}-unmapped`,
        externalName: "Ambiguous name",
        mappingStatus: "REVIEW_REQUIRED",
        notes: "Deliberately not matched on name similarity.",
      },
      select: { id: true, foodId: true },
    });
    expect(created.foodId).toBeNull();
    await prisma.sourceFood.delete({ where: { id: created.id } });
  });

  it("refuses a second global conversion for the same unit pair", async () => {
    const from = await prisma.unit.findUniqueOrThrow({ where: { code: "kg" } });
    const to = await prisma.unit.findUniqueOrThrow({ where: { code: "g" } });

    // Postgres treats NULLs as distinct, so the composite key alone would let
    // two disagreeing global factors coexist. A partial index prevents it.
    await expect(
      prisma.unitConversion.create({
        data: { fromUnitId: from.id, toUnitId: to.id, factor: "999", sourceNote: "wrong" },
      }),
    ).rejects.toThrow();
  });

  it("refuses a conversion from a unit to itself", async () => {
    const unit = await prisma.unit.findUniqueOrThrow({ where: { code: "g" } });
    await expect(
      prisma.unitConversion.create({
        data: { fromUnitId: unit.id, toUnitId: unit.id, factor: "1", sourceNote: "noise" },
      }),
    ).rejects.toThrow();
  });

  it("protects a source version that has produced foods", async () => {
    await expect(
      prisma.nutritionSourceVersion.delete({ where: { id: versionId } }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Row Level Security
// ---------------------------------------------------------------------------

describe.skipIf(!enabled)("reference data is global", () => {
  it("a dietitian reads reference foods", async () => {
    const { rows } = await queryAs(
      practiceA.dietitianAuthId,
      `SELECT id FROM public.foods WHERE origin_source_version_id = $1`,
      [versionId],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a dietitian in another practice reads the same rows", async () => {
    // This is the point of global reference data, and the one place in the
    // product where a cross-practice read is correct.
    const a = await queryAs(
      practiceA.dietitianAuthId,
      `SELECT id FROM public.foods WHERE origin_source_version_id = $1`,
      [versionId],
    );
    const b = await queryAs(
      practiceB.dietitianAuthId,
      `SELECT id FROM public.foods WHERE origin_source_version_id = $1`,
      [versionId],
    );
    expect(b.rows.length).toBe(a.rows.length);
    expect(b.rows.length).toBeGreaterThan(0);
  });

  it("an owner reads nutrient values, nutrients, sources, and units", async () => {
    for (const table of [
      "food_nutrients",
      "nutrients",
      "nutrition_sources",
      "nutrition_source_versions",
      "food_aliases",
      "units",
      "unit_conversions",
    ]) {
      const { rows, error } = await queryAs(
        practiceA.ownerAuthId,
        `SELECT count(*)::int AS n FROM public.${table}`,
      );
      expect(error, table).toBeUndefined();
      expect(Number((rows[0] as { n: number } | undefined)?.n ?? 0), table).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!enabled)("reference data access boundaries", () => {
  it("a receptionist reads no reference data", async () => {
    const { rows } = await queryAs(
      practiceA.receptionistAuthId,
      `SELECT id FROM public.foods WHERE origin_source_version_id = $1`,
      [versionId],
    );
    expect(rows).toHaveLength(0);
  });

  it("a signed-out visitor reads nothing", async () => {
    for (const table of ["foods", "food_nutrients", "nutrients", "nutrition_sources"]) {
      const { rows } = await queryAs(null, `SELECT * FROM public.${table} LIMIT 1`);
      expect(rows, table).toHaveLength(0);
    }
  });

  it("nobody reads the raw ingestion tables through the browser", async () => {
    // source_foods holds raw dataset payloads whose redistribution terms are
    // unreviewed; dataset_imports is operational telemetry.
    for (const authId of [practiceA.ownerAuthId, practiceA.dietitianAuthId, null]) {
      for (const table of ["source_foods", "dataset_imports"]) {
        const { rows } = await queryAs(authId, `SELECT * FROM public.${table} LIMIT 1`);
        expect(rows, `${table} as ${authId ?? "anon"}`).toHaveLength(0);
      }
    }
  });
});

describe.skipIf(!enabled)("reference data is read-only", () => {
  it("an owner cannot insert a food", async () => {
    const { error } = await queryAs(
      practiceA.ownerAuthId,
      `INSERT INTO public.foods (canonical_name, category, food_type)
       VALUES ('Injected food', 'OTHER', 'RAW')`,
    );
    expect(error).toBeDefined();
  });

  it("a dietitian cannot edit a published nutrient value", async () => {
    // The core of it: a practitioner must not be able to rewrite the reference
    // figure that every plan in the product will be built on.
    const { error } = await queryAs(
      practiceA.dietitianAuthId,
      `UPDATE public.food_nutrients SET value = 1 WHERE source_version_id = $1`,
      [versionId],
    );
    expect(error).toBeDefined();
  });

  it("a dietitian cannot delete a food", async () => {
    const { error } = await queryAs(
      practiceA.dietitianAuthId,
      `DELETE FROM public.foods WHERE origin_source_version_id = $1`,
      [versionId],
    );
    expect(error).toBeDefined();
  });

  it("nobody can rewrite a source's licence status", async () => {
    const { error } = await queryAs(
      practiceA.ownerAuthId,
      `UPDATE public.nutrition_sources SET permission_status = 'APPROVED'`,
    );
    expect(error).toBeDefined();
  });

  it("nobody can add a nutrient or a unit conversion", async () => {
    const nutrient = await queryAs(
      practiceA.ownerAuthId,
      `INSERT INTO public.nutrients (code, name, category, unit)
       VALUES ('MADE_UP', 'Made up', 'OTHER', 'MG')`,
    );
    expect(nutrient.error).toBeDefined();

    const conversion = await queryAs(
      practiceA.dietitianAuthId,
      `INSERT INTO public.units (code, name, category) VALUES ('zz', 'Bogus', 'WEIGHT')`,
    );
    expect(conversion.error).toBeDefined();
  });
});

describe.skipIf(!enabled)("tenant isolation is unchanged", () => {
  it("a global read does not expose another practice's clients", async () => {
    const client = await prisma.client.create({
      data: {
        organizationId: practiceB.orgId,
        clientNumber: `${run}-C1`,
        firstName: "Synthetic",
        lastName: "Client",
      },
      select: { id: true },
    });

    try {
      const { rows } = await queryAs(
        practiceA.dietitianAuthId,
        `SELECT id FROM public.clients WHERE id = $1`,
        [client.id],
      );
      // Reference data crosses practices. Client data still does not.
      expect(rows).toHaveLength(0);
    } finally {
      await prisma.client.delete({ where: { id: client.id } });
    }
  });

  it("the clinical-user predicate does not grant organization membership", async () => {
    const { rows } = await queryAs(
      practiceA.ownerAuthId,
      `SELECT id FROM public.organizations WHERE id = $1`,
      [practiceB.orgId],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("nutrition test configuration", () => {
  it("reports why the database suites were skipped", () => {
    if (!hasRlsDatabase()) {
      console.warn(
        "RLS_TEST_DATABASE_URL is not set — nutrition database tests were skipped.",
      );
    } else if (!enabled) {
      console.warn(UNREACHABLE_MESSAGE);
    }
    expect(true).toBe(true);
  });
});
