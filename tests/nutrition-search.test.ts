import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { indbAdapter } from "../src/lib/nutrition/adapters";
import { runAdapterImport } from "../src/services/nutrition/import";
import {
  ensureSourceVersion,
  syncNutritionRegistry,
} from "../src/services/nutrition/registry";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  queryAs,
  rlsDatabaseUrl,
} from "./helpers/rls-db";

/**
 * Adapter-driven import and food search, against a real database.
 *
 * ALL DATA HERE IS SYNTHETIC. The rows are shaped like INDB rows so the real
 * adapter is exercised, but every value is invented and the version label is
 * unique per run, so a test can never touch imported production data.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `ns${Date.now().toString(36)}`;
const VERSION = `test-${run}`;

let prisma: PrismaClient;
let versionId: string;

/** TEST FIXTURE — synthetic rows in INDB's column layout. */
const HEADERS = [
  "food_code",
  "food_name",
  "primarysource",
  "servings_unit",
  "energy_kcal",
  "protein_g",
  "fat_g",
  "iron_mg",
  "calcium_mg",
  "sodium_mg",
  "unit_serving_energy_kcal",
  "unit_serving_protein_g",
  "unit_serving_fat_g",
  "unit_serving_iron_mg",
  "unit_serving_calcium_mg",
  "unit_serving_sodium_mg",
  "vitb9_ug",
];

function row(
  code: string,
  name: string,
  serving: string,
  factor: number,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const per100 = {
    energy_kcal: "200",
    protein_g: "10",
    fat_g: "5",
    iron_mg: "2",
    calcium_mg: "80",
    sodium_mg: "300",
  };
  const perServing = Object.fromEntries(
    Object.entries(per100).map(([key, value]) => [
      `unit_serving_${key}`,
      String(Number(value) * factor),
    ]),
  );

  return {
    food_code: code,
    food_name: name,
    primarysource: "test_manual",
    servings_unit: serving,
    vitb9_ug: "5",
    ...per100,
    ...perServing,
    ...overrides,
  };
}

const ROWS = [
  row("SYN-A", "Plain khitchdi (Plain khichri/khichdi)", "small bowl", 2),
  row("SYN-B", "Masala dosa", "dosa", 1.5),
  row("SYN-C", "Hot tea (Garam Chai)", "tea cup", 1.2),
  row("SYN-D", "दाल तड़का", "bowl", 2.5),
];

let practiceA: { orgId: string; ownerAuthId: string; receptionistAuthId: string };

beforeAll(async () => {
  if (!enabled) return;

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: rlsDatabaseUrl! }),
  });

  await syncNutritionRegistry(prisma);
  versionId = (await ensureSourceVersion(prisma, "INDB", VERSION)).id;

  await runAdapterImport({
    prisma,
    adapter: indbAdapter,
    headers: HEADERS,
    rows: ROWS,
    version: VERSION,
    fileName: "synthetic.xlsx",
    checksum: "0".repeat(64),
  });

  // A practice, so the RLS assertions have real memberships to evaluate.
  const makeUser = async (suffix: string) => {
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
  };

  const owner = await makeUser("owner");
  const receptionist = await makeUser("recep");
  const org = await prisma.organization.create({
    data: { name: `${run} practice`, slug: `${run}-practice` },
    select: { id: true },
  });

  for (const [profileId, role] of [
    [owner.profileId, "OWNER"],
    [receptionist.profileId, "RECEPTIONIST"],
  ] as const) {
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: profileId, role, status: "ACTIVE" },
    });
  }

  practiceA = {
    orgId: org.id,
    ownerAuthId: owner.authId,
    receptionistAuthId: receptionist.authId,
  };
}, 120_000);

afterAll(async () => {
  if (!enabled || !prisma) return;

  await prisma.foodNutrient.deleteMany({ where: { sourceVersionId: versionId } });
  await prisma.foodServing.deleteMany({ where: { sourceVersionId: versionId } });
  await prisma.sourceFood.deleteMany({ where: { sourceVersionId: versionId } });
  await prisma.sourceNutrientMapping.deleteMany({ where: { sourceVersionId: versionId } });
  await prisma.foodAlias.deleteMany({
    where: { food: { originSourceVersionId: versionId } },
  });
  await prisma.food.deleteMany({ where: { originSourceVersionId: versionId } });
  await prisma.datasetImport.deleteMany({ where: { sourceVersionId: versionId } });
  await prisma.nutritionSourceVersion.deleteMany({ where: { version: VERSION } });

  await prisma.organizationMember.deleteMany({ where: { organizationId: practiceA.orgId } });
  await prisma.organization.deleteMany({ where: { id: practiceA.orgId } });
  await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE email LIKE '${run}-%'`);

  await prisma.$disconnect();
});

describe.skipIf(!enabled)("adapter import", () => {
  it("imports every record", async () => {
    const foods = await prisma.food.count({ where: { originSourceVersionId: versionId } });
    expect(foods).toBe(ROWS.length);
  });

  it("records the column mapping, including what it could not map", async () => {
    const mappings = await prisma.sourceNutrientMapping.findMany({
      where: { sourceVersionId: versionId },
      select: { sourceNutrientCode: true, status: true, notes: true },
    });

    const mapped = mappings.filter((m) => m.status === "MAPPED");
    expect(mapped.length).toBeGreaterThan(0);

    // vitb9 is folate under another name. Left unmapped deliberately, and the
    // reason is stored rather than lost.
    const b9 = mappings.find((m) => m.sourceNutrientCode === "vitb9_ug");
    expect(b9?.status).toBe("UNMAPPED");
    expect(b9?.notes).toMatch(/folate/i);
  });

  it("stores no vitamin B12, because the source publishes none", async () => {
    const b12 = await prisma.nutrient.findUniqueOrThrow({ where: { code: "VITAMIN_B12" } });
    const values = await prisma.foodNutrient.count({
      where: { sourceVersionId: versionId, nutrientId: b12.id },
    });
    // Absence of a row means "not measured" — never a fabricated zero.
    expect(values).toBe(0);
  });

  it("records how a food was matched", async () => {
    const sourceFood = await prisma.sourceFood.findFirstOrThrow({
      where: { sourceVersionId: versionId, externalId: "SYN-A" },
      select: { mappingStatus: true, mappingMethod: true },
    });
    expect(sourceFood.mappingStatus).toBe("MAPPED");
    // On the publisher's own identifier — never on name similarity.
    expect(sourceFood.mappingMethod).toBe("EXACT_SOURCE_ID");
  });

  it("is idempotent", async () => {
    const before = await prisma.foodNutrient.count({ where: { sourceVersionId: versionId } });

    const result = await runAdapterImport({
      prisma,
      adapter: indbAdapter,
      headers: HEADERS,
      rows: ROWS,
      version: VERSION,
      fileName: "synthetic.xlsx",
      checksum: "0".repeat(64),
    });

    expect(result.statistics.foodsCreated).toBe(0);
    expect(result.statistics.foodsUpdated).toBe(ROWS.length);
    expect(await prisma.foodNutrient.count({ where: { sourceVersionId: versionId } })).toBe(
      before,
    );
  });

  it("fails the run when the file is not what the adapter expects", async () => {
    const result = await runAdapterImport({
      prisma,
      adapter: indbAdapter,
      headers: ["something", "else"],
      rows: [{ something: "x", else: "y" }],
      version: VERSION,
      fileName: "wrong.xlsx",
      checksum: "1".repeat(64),
    });
    expect(result.status).toBe("FAILED");
  });
});

describe.skipIf(!enabled)("serving weights", () => {
  it("recovers the weight the source implied", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-A" },
      select: { id: true },
    });
    const serving = await prisma.foodServing.findFirstOrThrow({
      where: { foodId: food.id },
    });

    expect(serving.label).toBe("small bowl");
    // Per-serving figures are 2× per-100 g, so one serving is 200 g.
    expect(Number(serving.weightGrams)).toBe(200);
    expect(serving.weightMethod).toBe("DERIVED_FROM_SOURCE");
    expect(Number(serving.agreementSpread)).toBe(0);
  });

  it("handles a fractional multiplier without drift", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-B" },
      select: { id: true },
    });
    const serving = await prisma.foodServing.findFirstOrThrow({ where: { foodId: food.id } });
    expect(Number(serving.weightGrams)).toBe(150);
  });

  it("refuses a weight with no method behind it", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId },
      select: { id: true },
    });

    // "We do not know what a bowl weighs" and "a bowl weighs 173 g" must stay
    // distinguishable, so the database refuses the contradiction.
    await expect(
      prisma.foodServing.create({
        data: {
          foodId: food.id,
          sourceVersionId: versionId,
          label: `${run}-bad`,
          weightGrams: "173",
          weightMethod: "UNKNOWN",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a zero portion weight", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId },
      select: { id: true },
    });
    await expect(
      prisma.foodServing.create({
        data: {
          foodId: food.id,
          sourceVersionId: versionId,
          label: `${run}-zero`,
          weightGrams: "0",
          weightMethod: "PUBLISHED",
        },
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!enabled)("food search", () => {
  /** Mirrors the service's matching so the DB behaviour is what is asserted. */
  const find = (tokens: string[]) =>
    prisma.food.findMany({
      where: {
        originSourceVersionId: versionId,
        AND: tokens.map((token) => ({ normalizedName: { contains: token } })),
      },
      orderBy: [{ canonicalName: "asc" }, { id: "asc" }],
      select: { canonicalName: true },
    });

  it("finds a word hidden behind brackets and slashes in the published name", async () => {
    // "Plain khitchdi (Plain khichri/khichdi)" — a dietitian types "khichdi".
    const results = await find(["khichdi"]);
    expect(results.map((f) => f.canonicalName)).toContain(
      "Plain khitchdi (Plain khichri/khichdi)",
    );
  });

  it("finds a bracketed alternative name", async () => {
    const results = await find(["chai"]);
    expect(results.map((f) => f.canonicalName)).toContain("Hot tea (Garam Chai)");
  });

  it("narrows rather than widens as words are added", async () => {
    const one = await find(["dosa"]);
    const two = await find(["masala", "dosa"]);
    expect(two.length).toBeLessThanOrEqual(one.length);
    expect(two.map((f) => f.canonicalName)).toContain("Masala dosa");
  });

  it("preserves Devanagari names", async () => {
    // Indic vowel signs are combining marks, not letters. A normaliser that
    // strips them turns "दाल" into "द ल" and makes the food unfindable.
    const results = await find(["दाल"]);
    expect(results.map((f) => f.canonicalName)).toContain("दाल तड़का");
  });

  it("orders deterministically, so paging cannot repeat or skip a row", async () => {
    const first = await find([]);
    const second = await find([]);
    expect(first.map((f) => f.canonicalName)).toEqual(second.map((f) => f.canonicalName));
  });

  it("leaves the published name untouched", async () => {
    const food = await prisma.food.findFirstOrThrow({
      where: { originSourceVersionId: versionId, originSourceFoodId: "SYN-A" },
      select: { canonicalName: true, normalizedName: true },
    });
    expect(food.canonicalName).toBe("Plain khitchdi (Plain khichri/khichdi)");
    expect(food.normalizedName).toBe("plain khitchdi plain khichri khichdi");
  });
});

describe.skipIf(!enabled)("new tables keep the Phase 8A security posture", () => {
  it("a clinical user reads servings", async () => {
    // A food picker has to be able to offer "1 bowl".
    const { rows } = await queryAs(
      practiceA.ownerAuthId,
      `SELECT id FROM public.food_servings LIMIT 1`,
    );
    expect(rows.length).toBe(1);
  });

  it("a receptionist reads no servings", async () => {
    const { rows } = await queryAs(
      practiceA.receptionistAuthId,
      `SELECT id FROM public.food_servings LIMIT 1`,
    );
    expect(rows).toHaveLength(0);
  });

  it("a signed-out visitor reads nothing", async () => {
    const { rows } = await queryAs(null, `SELECT id FROM public.food_servings LIMIT 1`);
    expect(rows).toHaveLength(0);
  });

  it("nobody reads the nutrient mapping table through the browser", async () => {
    // Ingestion metadata, like source_foods and dataset_imports.
    for (const authId of [practiceA.ownerAuthId, null]) {
      const { rows } = await queryAs(
        authId,
        `SELECT id FROM public.source_nutrient_mappings LIMIT 1`,
      );
      expect(rows).toHaveLength(0);
    }
  });

  it("nobody can write a serving weight", async () => {
    const { error } = await queryAs(
      practiceA.ownerAuthId,
      `UPDATE public.food_servings SET weight_grams = 1`,
    );
    expect(error).toBeDefined();
  });

  it("nobody can insert a food", async () => {
    const { error } = await queryAs(
      practiceA.ownerAuthId,
      `INSERT INTO public.foods (canonical_name, normalized_name, category, food_type)
       VALUES ('Injected', 'injected', 'OTHER', 'RAW')`,
    );
    expect(error).toBeDefined();
  });
});
