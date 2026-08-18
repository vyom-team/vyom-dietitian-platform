import type { PrismaClient } from "@/generated/prisma/client";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/nutrients";
import { SOURCE_DEFINITIONS } from "@/lib/nutrition/sources";
import { GLOBAL_UNIT_CONVERSIONS, UNIT_DEFINITIONS } from "@/lib/nutrition/units";

/**
 * Synchronises the nutrition vocabulary into the database.
 *
 * Sources, nutrients, units, and the two SI unit conversions. **No food and no
 * nutrient value** — this writes the words, never the measurements.
 *
 * The vocabulary is defined in code rather than in a seed file so it is
 * reviewable in a diff and versioned with the schema that depends on it. This
 * function projects it into the database and is safe to run repeatedly.
 *
 * It takes a PrismaClient rather than importing one. Scripts, tests, and the
 * application each have their own, and a module that reaches for a singleton
 * cannot be pointed at a disposable test database.
 */

export type RegistrySyncResult = {
  sourcesCreated: number;
  sourcesUpdated: number;
  nutrientsCreated: number;
  nutrientsUpdated: number;
  unitsCreated: number;
  unitsUpdated: number;
  conversionsCreated: number;
  conversionsUpdated: number;
};

export async function syncNutritionRegistry(
  prisma: PrismaClient,
): Promise<RegistrySyncResult> {
  const result: RegistrySyncResult = {
    sourcesCreated: 0,
    sourcesUpdated: 0,
    nutrientsCreated: 0,
    nutrientsUpdated: 0,
    unitsCreated: 0,
    unitsUpdated: 0,
    conversionsCreated: 0,
    conversionsUpdated: 0,
  };

  for (const definition of SOURCE_DEFINITIONS) {
    const existing = await prisma.nutritionSource.findUnique({
      where: { code: definition.code },
      select: { id: true },
    });

    /*
     * LICENCE FIELDS ARE WRITTEN ON CREATE ONLY.
     *
     * A sync must never reset a permission status. If someone has reviewed a
     * dataset's terms and recorded APPROVED, re-running this script cannot
     * quietly revert that to DEVELOPMENT_ONLY — and, just as important, a
     * changed default in code cannot silently grant a clearance nobody made.
     *
     * Descriptive fields are refreshed; the four status fields are not.
     */
    const descriptive = {
      name: definition.name,
      organization: definition.organization ?? null,
      country: definition.country ?? null,
      description: definition.description,
      sourceUrl: definition.sourceUrl ?? null,
      licenseName: definition.licenseName ?? null,
      licenseUrl: definition.licenseUrl ?? null,
      metadata: { reviewNote: definition.reviewNote },
    };

    if (existing) {
      await prisma.nutritionSource.update({
        where: { id: existing.id },
        data: descriptive,
      });
      result.sourcesUpdated += 1;
    } else {
      await prisma.nutritionSource.create({
        data: {
          code: definition.code,
          ...descriptive,
          commercialUseStatus: definition.commercialUseStatus,
          redistributionStatus: definition.redistributionStatus,
          permissionStatus: definition.permissionStatus,
          attributionRequired: definition.attributionRequired,
          status: definition.status,
        },
      });
      result.sourcesCreated += 1;
    }
  }

  for (const [index, definition] of NUTRIENT_DEFINITIONS.entries()) {
    const data = {
      name: definition.name,
      category: definition.category,
      unit: definition.unit,
      description: definition.description ?? null,
      displayOrder: index,
    };

    const existing = await prisma.nutrient.findUnique({
      where: { code: definition.code },
      select: { id: true },
    });

    if (existing) {
      await prisma.nutrient.update({ where: { id: existing.id }, data });
      result.nutrientsUpdated += 1;
    } else {
      await prisma.nutrient.create({ data: { code: definition.code, ...data } });
      result.nutrientsCreated += 1;
    }
  }

  for (const definition of UNIT_DEFINITIONS) {
    const data = {
      name: definition.name,
      category: definition.category,
      isCanonical: definition.isCanonical ?? false,
      requiresFoodContext: definition.requiresFoodContext ?? false,
      description: definition.description ?? null,
    };

    const existing = await prisma.unit.findUnique({
      where: { code: definition.code },
      select: { id: true },
    });

    if (existing) {
      await prisma.unit.update({ where: { id: existing.id }, data });
      result.unitsUpdated += 1;
    } else {
      await prisma.unit.create({ data: { code: definition.code, ...data } });
      result.unitsCreated += 1;
    }
  }

  for (const conversion of GLOBAL_UNIT_CONVERSIONS) {
    const from = await prisma.unit.findUnique({
      where: { code: conversion.fromCode },
      select: { id: true },
    });
    const to = await prisma.unit.findUnique({
      where: { code: conversion.toCode },
      select: { id: true },
    });
    if (!from || !to) continue;

    /*
     * findFirst rather than upsert: the unique key includes the nullable
     * `foodId`, and Prisma will not accept null in a compound unique lookup.
     * The database still enforces one global conversion per unit pair through
     * a partial unique index.
     */
    const existing = await prisma.unitConversion.findFirst({
      where: { fromUnitId: from.id, toUnitId: to.id, foodId: null },
      select: { id: true },
    });

    if (existing) {
      await prisma.unitConversion.update({
        where: { id: existing.id },
        data: { factor: conversion.factor, sourceNote: conversion.sourceNote },
      });
      result.conversionsUpdated += 1;
    } else {
      await prisma.unitConversion.create({
        data: {
          fromUnitId: from.id,
          toUnitId: to.id,
          foodId: null,
          factor: conversion.factor,
          sourceNote: conversion.sourceNote,
        },
      });
      result.conversionsCreated += 1;
    }
  }

  return result;
}

/**
 * Finds or creates the release row for a source and version label.
 *
 * Creating a version is not the same as importing it: `importedAt` stays null
 * until an import actually completes, so an empty release is distinguishable
 * from one that has data.
 */
export async function ensureSourceVersion(
  prisma: PrismaClient,
  sourceCode: string,
  version: string,
): Promise<{ id: string; sourceId: string; sourceName: string }> {
  const source = await prisma.nutritionSource.findUnique({
    where: { code: sourceCode },
    select: { id: true, name: true },
  });

  if (!source) {
    throw new Error(
      `Unknown nutrition source "${sourceCode}". Run the registry sync first, ` +
        "and register the source in src/lib/nutrition/sources.ts if it is new.",
    );
  }

  const existing = await prisma.nutritionSourceVersion.findUnique({
    where: { sourceId_version: { sourceId: source.id, version } },
    select: { id: true },
  });

  if (existing) {
    return { id: existing.id, sourceId: source.id, sourceName: source.name };
  }

  const created = await prisma.nutritionSourceVersion.create({
    data: { sourceId: source.id, version },
    select: { id: true },
  });

  return { id: created.id, sourceId: source.id, sourceName: source.name };
}
