-- ===========================================================================
-- Phase 8D — nutrition requirement references
--
-- The requirement side of nutrition, separate from the composition side added
-- in 8A/8B. A food table says what is in a food; a reference rule says how much
-- a person needs. Different publications, different licensing.
--
-- THIS MIGRATION CREATES STRUCTURE AND NO DATA.
--
-- Not an oversight. ICMR-NIN RDA/EAR 2020 is registered as a source but has not
-- been acquired and is marked PERMISSION_REQUIRED, so there is no licensed
-- requirement value to insert. The table exists so that when one arrives it has
-- a versioned, provenanced home — never so that a plausible number can be
-- seeded into it.
-- ===========================================================================

CREATE TYPE "reference_rule_type" AS ENUM (
  'BMR_EQUATION',
  'ACTIVITY_FACTOR',
  'GOAL_ENERGY_ADJUSTMENT',
  'PROTEIN_PER_KG',
  'FAT_ENERGY_PERCENT',
  'CARBOHYDRATE_ENERGY_PERCENT',
  'FIBRE_INTAKE',
  'MICRONUTRIENT_INTAKE'
);

CREATE TYPE "reference_value_type" AS ENUM (
  'RDA', 'EAR', 'AI', 'UL', 'RANGE', 'FACTOR', 'EQUATION'
);

CREATE TYPE "sex_applicability" AS ENUM ('ANY', 'FEMALE', 'MALE');

CREATE TYPE "physiological_state" AS ENUM ('NONE', 'PREGNANCY', 'LACTATION');

CREATE TYPE "reference_unit" AS ENUM (
  'KCAL_PER_DAY',
  'G_PER_DAY',
  'MG_PER_DAY',
  'UG_PER_DAY',
  'G_PER_KG_PER_DAY',
  'PERCENT_OF_ENERGY',
  'FACTOR'
);


-- ---------------------------------------------------------------------------
-- reference_rules
-- ---------------------------------------------------------------------------

CREATE TABLE "reference_rules" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_version_id"   UUID NOT NULL,
  "rule_type"           "reference_rule_type" NOT NULL,
  "nutrient_id"         UUID,
  "rule_key"            VARCHAR(60),
  "sex_applicability"   "sex_applicability" NOT NULL DEFAULT 'ANY',
  "age_min_years"       INTEGER,
  "age_max_years"       INTEGER,
  "physiological_state" "physiological_state" NOT NULL DEFAULT 'NONE',
  "value_type"          "reference_value_type" NOT NULL,
  "value"               DECIMAL(14,6),
  "value_min"           DECIMAL(14,6),
  "value_max"           DECIMAL(14,6),
  "unit"                "reference_unit" NOT NULL,
  "notes"               TEXT,
  "is_active"           BOOLEAN NOT NULL DEFAULT true,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reference_rules_pkey" PRIMARY KEY ("id")
);

-- A micronutrient rule is about a nutrient; every other rule type is not.
-- Without this, a protein rule could carry a calcium nutrient id and resolve
-- into the wrong target.
ALTER TABLE "reference_rules"
  ADD CONSTRAINT "reference_rules_nutrient_matches_type"
  CHECK (
    (rule_type = 'MICRONUTRIENT_INTAKE' AND nutrient_id IS NOT NULL AND rule_key IS NULL)
    OR
    (rule_type <> 'MICRONUTRIENT_INTAKE' AND nutrient_id IS NULL)
  );

-- The value shape must match what the publisher actually stated. A RANGE with
-- only one bound, or an RDA with none, is a transcription error and must not
-- reach a clinical calculation.
ALTER TABLE "reference_rules"
  ADD CONSTRAINT "reference_rules_value_matches_type"
  CHECK (
    (value_type = 'RANGE'    AND value IS NULL     AND value_min IS NOT NULL AND value_max IS NOT NULL)
    OR
    (value_type = 'EQUATION' AND value IS NULL     AND value_min IS NULL     AND value_max IS NULL)
    OR
    (value_type NOT IN ('RANGE', 'EQUATION') AND value IS NOT NULL AND value_min IS NULL AND value_max IS NULL)
  );

ALTER TABLE "reference_rules"
  ADD CONSTRAINT "reference_rules_range_ordered"
  CHECK (value_min IS NULL OR value_max IS NULL OR value_min <= value_max);

-- Requirements are never negative. A goal adjustment that removes energy is
-- expressed by its own rule type, not by a negative RDA.
ALTER TABLE "reference_rules"
  ADD CONSTRAINT "reference_rules_values_non_negative"
  CHECK (
    (value IS NULL OR value >= 0)
    AND (value_min IS NULL OR value_min >= 0)
    AND (value_max IS NULL OR value_max >= 0)
  );

ALTER TABLE "reference_rules"
  ADD CONSTRAINT "reference_rules_age_bounds_ordered"
  CHECK (
    age_min_years IS NULL OR age_max_years IS NULL OR age_min_years <= age_max_years
  );

ALTER TABLE "reference_rules"
  ADD CONSTRAINT "reference_rules_age_bounds_plausible"
  CHECK (
    (age_min_years IS NULL OR (age_min_years >= 0 AND age_min_years <= 130))
    AND (age_max_years IS NULL OR (age_max_years >= 0 AND age_max_years <= 130))
  );

-- Idempotency key for a future importer.
--
-- NULLS NOT DISTINCT is load-bearing: several columns are legitimately null
-- (rule_key for micronutrients, nutrient_id for everything else, unbounded age
-- ranges), and under default Postgres semantics two identical rules with a null
-- would both be accepted. Re-reading a table would then duplicate every rule.
CREATE UNIQUE INDEX "reference_rules_applicability_key"
  ON "reference_rules" (
    "source_version_id",
    "rule_type",
    "rule_key",
    "nutrient_id",
    "sex_applicability",
    "age_min_years",
    "age_max_years",
    "physiological_state"
  )
  NULLS NOT DISTINCT;

CREATE INDEX "reference_rules_rule_type_is_active_idx"
  ON "reference_rules" ("rule_type", "is_active");
CREATE INDEX "reference_rules_source_version_id_idx"
  ON "reference_rules" ("source_version_id");
CREATE INDEX "reference_rules_nutrient_id_idx"
  ON "reference_rules" ("nutrient_id");

ALTER TABLE "reference_rules"
  ADD CONSTRAINT "reference_rules_source_version_id_fkey"
  FOREIGN KEY ("source_version_id") REFERENCES "nutrition_source_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reference_rules"
  ADD CONSTRAINT "reference_rules_nutrient_id_fkey"
  FOREIGN KEY ("nutrient_id") REFERENCES "nutrients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Row Level Security
--
-- Same shape as the Phase 8A reference tables, and for the same reasons.
-- Requirement values are GLOBAL reference data: they belong to no organization,
-- every clinical user of every practice reads the same rows, and no application
-- role may write them. There is deliberately no organization_id column.
--
-- SELECT only, clinical users only. `anon` gets nothing.
-- ===========================================================================

ALTER TABLE public.reference_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reference_rules FROM anon;
REVOKE ALL ON public.reference_rules FROM authenticated;
GRANT SELECT ON public.reference_rules TO authenticated;
CREATE POLICY reference_rules_select_clinical
  ON public.reference_rules FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());
