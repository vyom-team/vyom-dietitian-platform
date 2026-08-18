import "server-only";

import type { FoodCategory, FoodType, PreparationState } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { normalizeSearchTerm, searchTokens } from "@/lib/nutrition/normalize-name";

/**
 * Food search.
 *
 * Server-side, always. The food database is tens of thousands of nutrient rows
 * across a thousand foods and will grow by an order of magnitude when a
 * composition table lands; shipping it to the browser to filter there would be
 * slow now and impossible later.
 *
 * ACCESS
 *
 * Reference data is global — every practice reads the same rows, and that is
 * correct. It is still restricted to clinical roles, and the *caller* is
 * responsible for that: pages call `requireClinicalContext()` before reaching
 * these functions. This module deliberately takes no organization id, because
 * there is no per-tenant food data to scope to.
 *
 * The database enforces the same boundary independently through RLS, so a
 * Supabase client cannot read foods without a clinical membership either.
 */

/** Page size cap. A caller asking for more gets this. */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

export type FoodSearchParams = {
  query?: string;
  category?: FoodCategory;
  foodType?: FoodType;
  preparationState?: PreparationState;
  /** Registered source code, e.g. "INDB". */
  sourceCode?: string;
  page?: number;
  pageSize?: number;
};

export type FoodSearchResult = {
  id: string;
  canonicalName: string;
  category: FoodCategory;
  foodType: FoodType;
  preparationState: PreparationState;
  /** Where this record came from — never hidden from the practitioner. */
  source: { code: string; name: string; version: string } | null;
  servings: { label: string; weightGrams: string | null }[];
  /** How many nutrient values this food carries. */
  nutrientCount: number;
};

export type FoodSearchPage = {
  results: FoodSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/**
 * Searches foods by name, alias, and filters.
 *
 * Matching is on the **normalized** name, using the same normalisation the
 * importer applied. A dietitian typing "khichdi" finds
 * "Plain khitchdi (Plain khichri/khichdi)" — the word is behind a bracket and a
 * slash in the published name, and only the normalized form exposes it.
 *
 * Every token must match somewhere, so "masala dosa" narrows rather than
 * widens. Nothing here does fuzzy or phonetic matching: "dal" and "daal" are
 * different strings, and guessing between them is how a plan ends up built on
 * the wrong food.
 */
export async function searchFoods(params: FoodSearchParams): Promise<FoodSearchPage> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE)),
  );

  const tokens = params.query ? searchTokens(params.query) : [];

  const where = {
    isActive: true,
    ...(params.category ? { category: params.category } : {}),
    ...(params.foodType ? { foodType: params.foodType } : {}),
    ...(params.preparationState ? { preparationState: params.preparationState } : {}),
    ...(params.sourceCode
      ? { originSourceVersion: { source: { code: params.sourceCode } } }
      : {}),
    /*
     * AND across tokens, OR across fields: each word must appear in the name or
     * in one of the aliases, but not necessarily the same one. That is what
     * makes a two-word query narrow the result rather than broaden it.
     */
    ...(tokens.length > 0
      ? {
          AND: tokens.map((token) => ({
            OR: [
              { normalizedName: { contains: token } },
              { aliases: { some: { alias: { contains: token, mode: "insensitive" as const } } } },
            ],
          })),
        }
      : {}),
  };

  const [total, foods] = await Promise.all([
    prisma.food.count({ where }),
    prisma.food.findMany({
      where,
      /*
       * Deterministic ordering, always. Name then id: without the id tiebreak
       * two foods sharing a name could swap places between pages, so a user
       * paging through would see one twice and another never.
       */
      orderBy: [{ canonicalName: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        canonicalName: true,
        category: true,
        foodType: true,
        preparationState: true,
        originSourceVersion: {
          select: { version: true, source: { select: { code: true, name: true } } },
        },
        servings: {
          select: { label: true, weightGrams: true },
          orderBy: [{ isDefault: "desc" }, { label: "asc" }],
        },
        _count: { select: { nutrients: true } },
      },
    }),
  ]);

  return {
    results: foods.map((food) => ({
      id: food.id,
      canonicalName: food.canonicalName,
      category: food.category,
      foodType: food.foodType,
      preparationState: food.preparationState,
      source: food.originSourceVersion
        ? {
            code: food.originSourceVersion.source.code,
            name: food.originSourceVersion.source.name,
            version: food.originSourceVersion.version,
          }
        : null,
      servings: food.servings.map((serving) => ({
        label: serving.label,
        // Decimal → string, never a float. A portion weight is reference data.
        weightGrams: serving.weightGrams?.toString() ?? null,
      })),
      nutrientCount: food._count.nutrients,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type FoodDetail = {
  id: string;
  canonicalName: string;
  normalizedName: string;
  description: string | null;
  category: FoodCategory;
  foodType: FoodType;
  preparationState: PreparationState;
  source: {
    code: string;
    name: string;
    version: string;
    /** Shown to the practitioner: this data is not cleared for commercial use. */
    permissionStatus: string;
    attributionRequired: boolean;
  } | null;
  externalId: string | null;
  aliases: string[];
  servings: {
    label: string;
    weightGrams: string | null;
    weightMethod: string;
  }[];
  nutrients: {
    code: string;
    name: string;
    category: string;
    value: string;
    unit: string;
    basisQuantity: string;
    basisUnitCode: string;
  }[];
};

/**
 * One food with everything known about it.
 *
 * Returns null rather than throwing for an unknown id, so a route can render
 * not-found without distinguishing "no such food" from "not visible".
 *
 * Nutrient values come back as **strings**. They are NUMERIC in the database
 * and a reference figure must not acquire floating-point error on its way to a
 * screen; formatting is the UI's job and rounding belongs there, not here.
 */
export async function getFood(foodId: string): Promise<FoodDetail | null> {
  const food = await prisma.food.findUnique({
    where: { id: foodId },
    select: {
      id: true,
      canonicalName: true,
      normalizedName: true,
      description: true,
      category: true,
      foodType: true,
      preparationState: true,
      originSourceFoodId: true,
      originSourceVersion: {
        select: {
          version: true,
          source: {
            select: {
              code: true,
              name: true,
              permissionStatus: true,
              attributionRequired: true,
            },
          },
        },
      },
      aliases: { select: { alias: true }, orderBy: { alias: "asc" } },
      servings: {
        select: { label: true, weightGrams: true, weightMethod: true },
        orderBy: [{ isDefault: "desc" }, { label: "asc" }],
      },
      nutrients: {
        select: {
          value: true,
          unit: true,
          basisQuantity: true,
          basisUnitCode: true,
          nutrient: {
            select: { code: true, name: true, category: true, displayOrder: true },
          },
        },
        orderBy: { nutrient: { displayOrder: "asc" } },
      },
    },
  });

  if (!food) return null;

  return {
    id: food.id,
    canonicalName: food.canonicalName,
    normalizedName: food.normalizedName,
    description: food.description,
    category: food.category,
    foodType: food.foodType,
    preparationState: food.preparationState,
    source: food.originSourceVersion
      ? {
          code: food.originSourceVersion.source.code,
          name: food.originSourceVersion.source.name,
          version: food.originSourceVersion.version,
          permissionStatus: food.originSourceVersion.source.permissionStatus,
          attributionRequired: food.originSourceVersion.source.attributionRequired,
        }
      : null,
    externalId: food.originSourceFoodId,
    aliases: food.aliases.map((alias) => alias.alias),
    servings: food.servings.map((serving) => ({
      label: serving.label,
      weightGrams: serving.weightGrams?.toString() ?? null,
      weightMethod: serving.weightMethod,
    })),
    nutrients: food.nutrients.map((entry) => ({
      code: entry.nutrient.code,
      name: entry.nutrient.name,
      category: entry.nutrient.category,
      value: entry.value.toString(),
      unit: entry.unit,
      basisQuantity: entry.basisQuantity.toString(),
      basisUnitCode: entry.basisUnitCode,
    })),
  };
}

/**
 * Which sources actually have foods, for a filter control.
 *
 * Driven by the data rather than by the registry: a source with no imported
 * foods should not appear as a filter that always returns nothing.
 */
export async function listSourcesWithFoods(): Promise<
  { code: string; name: string; count: number }[]
> {
  const sources = await prisma.nutritionSource.findMany({
    where: { versions: { some: { foodsOriginated: { some: {} } } } },
    select: {
      code: true,
      name: true,
      versions: { select: { _count: { select: { foodsOriginated: true } } } },
    },
    orderBy: { code: "asc" },
  });

  return sources.map((source) => ({
    code: source.code,
    name: source.name,
    count: source.versions.reduce(
      (total, version) => total + version._count.foodsOriginated,
      0,
    ),
  }));
}

/** Exported for tests: the normalisation search and import must agree on. */
export { normalizeSearchTerm };
