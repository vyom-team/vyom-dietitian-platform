/**
 * The nutrition source registry.
 *
 * Which datasets Vyom knows about, who publishes them, and — the part that
 * matters — what is and is not established about using them.
 *
 * LICENCE POSTURE
 *
 * Every entry below is `DEVELOPMENT_ONLY` with `UNKNOWN` commercial-use and
 * redistribution status. That is not laziness or a placeholder to fill in
 * later; it is the accurate state of this project. No licence review has been
 * carried out, and several of these datasets are known to carry restrictions.
 *
 * **Nothing in this codebase may set `APPROVED` or `PERMITTED`.** Those are
 * human legal determinations, recorded deliberately against a specific dataset
 * after someone has actually read its terms. The defaults exist so that silence
 * is never mistaken for clearance.
 *
 * Registering a source here is not permission to ship its data. It is the
 * opposite: it is the record of what we would have to clear first.
 *
 * See docs/nutrition-data.md.
 */

import type {
  DataUseStatus,
  NutritionSourceStatus,
  SourcePermissionStatus,
} from "@/generated/prisma/enums";

export type SourceDefinition = {
  /** Stable machine identifier. Referenced by dataset manifests. */
  code: string;
  name: string;
  organization?: string;
  /** ISO 3166-1 alpha-2 of the population the data describes. */
  country?: string;
  description: string;
  sourceUrl?: string;
  licenseName?: string;
  licenseUrl?: string;
  commercialUseStatus: DataUseStatus;
  redistributionStatus: DataUseStatus;
  permissionStatus: SourcePermissionStatus;
  attributionRequired: boolean;
  status: NutritionSourceStatus;
  /**
   * What still has to happen before this source could be used in production.
   * Written to the source's metadata so it travels with the row.
   */
  reviewNote: string;
};

export const SOURCE_DEFINITIONS: readonly SourceDefinition[] = [
  {
    code: "IFCT",
    name: "Indian Food Composition Tables",
    organization: "ICMR-National Institute of Nutrition",
    country: "IN",
    description:
      "The primary Indian food composition reference. Vyom's intended main source for food nutrient values.",
    commercialUseStatus: "UNKNOWN",
    redistributionStatus: "UNKNOWN",
    permissionStatus: "DEVELOPMENT_ONLY",
    attributionRequired: true,
    status: "ACTIVE",
    reviewNote:
      "Published terms have not been reviewed. Redistribution of the tables within a commercial product requires clearance from ICMR-NIN before launch.",
  },
  {
    code: "INDB",
    name: "Indian Nutrient Databank",
    country: "IN",
    description:
      "Indian food composition data covering prepared and composite dishes that IFCT does not itemise.",
    commercialUseStatus: "UNKNOWN",
    redistributionStatus: "UNKNOWN",
    permissionStatus: "DEVELOPMENT_ONLY",
    attributionRequired: true,
    status: "ACTIVE",
    reviewNote:
      "Publisher and licence terms are to be confirmed. The `organization` field is deliberately left empty rather than guessed.",
  },
  {
    code: "ICMR_NIN_RDA",
    name: "ICMR-NIN Recommended Dietary Allowances and Estimated Average Requirements",
    organization: "ICMR-National Institute of Nutrition",
    country: "IN",
    description:
      "Reference intake values for the Indian population. Not a food dataset: it supplies the requirement side, which a later phase needs before any target can be calculated.",
    commercialUseStatus: "UNKNOWN",
    redistributionStatus: "UNKNOWN",
    permissionStatus: "DEVELOPMENT_ONLY",
    attributionRequired: true,
    status: "ACTIVE",
    reviewNote:
      "Registered so requirement values have somewhere provenanced to live. No version is imported, and no requirement value exists in this codebase.",
  },
  {
    code: "ICMR_NIN_DG",
    name: "ICMR-NIN Dietary Guidelines for Indians",
    organization: "ICMR-National Institute of Nutrition",
    country: "IN",
    description:
      "Narrative dietary guidance. A source of practice guidelines rather than numeric food data.",
    commercialUseStatus: "UNKNOWN",
    redistributionStatus: "UNKNOWN",
    permissionStatus: "DEVELOPMENT_ONLY",
    attributionRequired: true,
    status: "ACTIVE",
    reviewNote:
      "Registered for provenance. Quoting guidance text in a commercial product needs its own review.",
  },
  {
    code: "USDA_FDC",
    name: "USDA FoodData Central",
    organization: "United States Department of Agriculture",
    country: "US",
    description:
      "Supplementary reference for foods absent from Indian datasets. Vyom V1 is India-first: this is a fallback for gaps, never the default source for an Indian food.",
    sourceUrl: "https://fdc.nal.usda.gov/",
    commercialUseStatus: "UNKNOWN",
    redistributionStatus: "UNKNOWN",
    permissionStatus: "DEVELOPMENT_ONLY",
    attributionRequired: true,
    status: "ACTIVE",
    reviewNote:
      "Widely described as public domain, but that has not been verified for this project and the status is therefore UNKNOWN. Recording a belief as a cleared status is exactly the mistake these columns exist to prevent.",
  },
] as const;

export const SOURCE_BY_CODE: ReadonlyMap<string, SourceDefinition> = new Map(
  SOURCE_DEFINITIONS.map((source) => [source.code, source]),
);

export function isKnownSourceCode(code: string): boolean {
  return SOURCE_BY_CODE.has(code);
}

/**
 * Whether values from a source may be shown in a production deployment.
 *
 * Nothing calls this yet — there is no production data and no food UI. It
 * exists so the check has one obvious home when the food database becomes
 * visible, rather than being reinvented at each call site.
 */
export function isApprovedForProduction(
  permissionStatus: SourcePermissionStatus,
): boolean {
  return permissionStatus === "APPROVED";
}
