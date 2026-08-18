-- ===========================================================================
-- Phase 8B — dataset ingestion
--
-- What building against a real dataset turned out to require:
--
--   * a searchable name distinct from the published one
--   * preparation state as its own field, not folded into food type
--   * servings, so a dietitian can say "one bowl" instead of "173.4 grams"
--   * the nutrient column mapping recorded per release, not only in a manifest
--   * source precedence as data rather than as logic spread through the code
--
-- Security posture is unchanged from Phase 8A: reference tables are readable
-- by clinical users of any practice and writable by none of them; ingestion
-- tables are unreachable from the browser entirely.
-- ===========================================================================

CREATE TYPE "preparation_state"       AS ENUM ('RAW', 'COOKED', 'UNKNOWN');
CREATE TYPE "source_priority"         AS ENUM ('PRIMARY_INDIAN', 'SECONDARY_INDIAN', 'SUPPLEMENTARY_INTERNATIONAL');
CREATE TYPE "mapping_method"          AS ENUM ('EXACT_SOURCE_ID', 'CONFIGURED', 'MANUAL', 'REVIEW_REQUIRED');
CREATE TYPE "nutrient_mapping_status" AS ENUM ('MAPPED', 'UNMAPPED', 'REVIEW_REQUIRED');
CREATE TYPE "serving_weight_method"   AS ENUM ('PUBLISHED', 'DERIVED_FROM_SOURCE', 'UNKNOWN');


-- ---------------------------------------------------------------------------
-- foods — searchable name and preparation state
--
-- `normalized_name` is added nullable, backfilled, then made NOT NULL, so the
-- migration is safe against a table that already holds rows.
-- ---------------------------------------------------------------------------
ALTER TABLE "foods" ADD COLUMN "normalized_name" VARCHAR(300);

-- Minimal backfill: lower-cased published name. The importer writes a fuller
-- normalisation, and a re-import refreshes these. This exists so the NOT NULL
-- below cannot fail, not as a substitute for the real normaliser.
UPDATE "foods" SET "normalized_name" = lower(btrim("canonical_name"))
 WHERE "normalized_name" IS NULL;

ALTER TABLE "foods" ALTER COLUMN "normalized_name" SET NOT NULL;

ALTER TABLE "foods"
  ADD CONSTRAINT "foods_normalized_name_not_blank"
  CHECK (length(btrim("normalized_name")) > 0);

-- Rice raw and rice cooked share a category and a type and differ in energy by
-- roughly a factor of three. UNKNOWN is the default because most sources do not
-- publish the distinction, and a guess here would be a guess about nutrition.
ALTER TABLE "foods"
  ADD COLUMN "preparation_state" "preparation_state" NOT NULL DEFAULT 'UNKNOWN';

CREATE INDEX "foods_normalized_name_idx" ON "foods"("normalized_name");
CREATE INDEX "foods_preparation_state_idx" ON "foods"("preparation_state");


-- ---------------------------------------------------------------------------
-- source_foods — how the tie was made
--
-- Nullable: rows written before this column existed genuinely have no recorded
-- method, and inventing one retrospectively would defeat the point.
-- ---------------------------------------------------------------------------
ALTER TABLE "source_foods" ADD COLUMN "mapping_method" "mapping_method";


-- ---------------------------------------------------------------------------
-- nutrition_sources — precedence as data
--
-- Defaults to the weakest precedence. A source becomes primary by a deliberate
-- write, never by arriving first.
-- ---------------------------------------------------------------------------
ALTER TABLE "nutrition_sources"
  ADD COLUMN "priority" "source_priority" NOT NULL DEFAULT 'SUPPLEMENTARY_INTERNATIONAL';


-- ---------------------------------------------------------------------------
-- food_servings
--
-- The table that makes the food database usable by a practitioner: "one bowl"
-- rather than "173.4 grams".
--
-- WEIGHTS ARE NEVER INVENTED. Phase 8A deliberately seeded no household
-- conversion because an unsourced "1 cup of rice = N g" is a fabricated number
-- underneath every later calculation. A row here carries its method: either
-- the source stated the weight, or it was recovered from the source's own
-- per-100 g and per-serving figures — and in that case `agreement_spread`
-- records how firmly the source implied it.
-- ---------------------------------------------------------------------------
CREATE TABLE "food_servings" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id"           UUID NOT NULL,
    "source_version_id" UUID NOT NULL,
    "label"             VARCHAR(80) NOT NULL,
    -- Null is meaningful: the source named a portion but gave no usable weight.
    "weight_grams"      NUMERIC(10,3),
    "weight_method"     "serving_weight_method" NOT NULL DEFAULT 'UNKNOWN',
    "agreement_spread"  NUMERIC(10,8),
    "is_default"        BOOLEAN NOT NULL DEFAULT false,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "food_servings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "food_servings"
  ADD CONSTRAINT "food_servings_label_not_blank"
  CHECK (length(btrim("label")) > 0);

-- A zero or negative portion weight would make every derived quantity nonsense.
ALTER TABLE "food_servings"
  ADD CONSTRAINT "food_servings_weight_positive"
  CHECK ("weight_grams" IS NULL OR "weight_grams" > 0);

-- A weight and its provenance travel together: a stated or derived weight must
-- exist, and an UNKNOWN method must not carry one. Otherwise "we do not know
-- what a bowl weighs" and "a bowl weighs 173 g" become indistinguishable.
ALTER TABLE "food_servings"
  ADD CONSTRAINT "food_servings_weight_matches_method"
  CHECK (
    ("weight_method" = 'UNKNOWN' AND "weight_grams" IS NULL)
    OR ("weight_method" <> 'UNKNOWN' AND "weight_grams" IS NOT NULL)
  );

-- Agreement only means something for a derived weight.
ALTER TABLE "food_servings"
  ADD CONSTRAINT "food_servings_spread_only_when_derived"
  CHECK (
    "agreement_spread" IS NULL
    OR ("weight_method" = 'DERIVED_FROM_SOURCE' AND "agreement_spread" >= 0)
  );

CREATE UNIQUE INDEX "food_servings_food_id_source_version_id_label_key"
  ON "food_servings"("food_id", "source_version_id", "label");
CREATE INDEX "food_servings_food_id_idx" ON "food_servings"("food_id");

ALTER TABLE "food_servings"
  ADD CONSTRAINT "food_servings_food_id_fkey"
  FOREIGN KEY ("food_id") REFERENCES "foods"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "food_servings"
  ADD CONSTRAINT "food_servings_source_version_id_fkey"
  FOREIGN KEY ("source_version_id") REFERENCES "nutrition_source_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- source_nutrient_mappings
--
-- Which of a source's columns became which Vyom nutrient, recorded per
-- release. Phase 8A kept this only in the dataset manifest, which was fine
-- while a manifest was the only route in; with adapters the mapping is
-- asserted by code and has to be written down somewhere auditable.
--
-- An UNMAPPED row is the point: a nutrient the source publishes and Vyom
-- cannot yet represent is a visible gap, not a silent drop.
-- ---------------------------------------------------------------------------
CREATE TABLE "source_nutrient_mappings" (
    "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_version_id"    UUID NOT NULL,
    "source_nutrient_code" VARCHAR(120) NOT NULL,
    "source_nutrient_name" VARCHAR(200),
    "source_unit"          VARCHAR(40),
    "nutrient_id"          UUID,
    "status"               "nutrient_mapping_status" NOT NULL DEFAULT 'UNMAPPED',
    "notes"                TEXT,
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "source_nutrient_mappings_pkey" PRIMARY KEY ("id")
);

-- MAPPED must actually point at a nutrient, and anything else must not.
ALTER TABLE "source_nutrient_mappings"
  ADD CONSTRAINT "source_nutrient_mappings_status_matches_nutrient"
  CHECK (
    ("status" = 'MAPPED' AND "nutrient_id" IS NOT NULL)
    OR ("status" <> 'MAPPED' AND "nutrient_id" IS NULL)
  );

CREATE UNIQUE INDEX "source_nutrient_mappings_source_version_id_code_key"
  ON "source_nutrient_mappings"("source_version_id", "source_nutrient_code");
CREATE INDEX "source_nutrient_mappings_status_idx"
  ON "source_nutrient_mappings"("status");

ALTER TABLE "source_nutrient_mappings"
  ADD CONSTRAINT "source_nutrient_mappings_source_version_id_fkey"
  FOREIGN KEY ("source_version_id") REFERENCES "nutrition_source_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "source_nutrient_mappings"
  ADD CONSTRAINT "source_nutrient_mappings_nutrient_id_fkey"
  FOREIGN KEY ("nutrient_id") REFERENCES "nutrients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Row Level Security for the new tables
--
-- Same shape as Phase 8A, and for the same reasons.
--
--   food_servings            reference data — clinical users read it, because
--                            a food picker has to offer "1 bowl". SELECT only.
--
--   source_nutrient_mappings ingestion metadata — nobody reads it through the
--                            browser, exactly like source_foods and
--                            dataset_imports. RLS on, zero policies, zero
--                            grants: a complete denial for any non-owner role.
-- ===========================================================================

ALTER TABLE public.food_servings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_servings FROM anon;
REVOKE ALL ON public.food_servings FROM authenticated;
GRANT SELECT ON public.food_servings TO authenticated;
CREATE POLICY food_servings_select_clinical
  ON public.food_servings FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());

ALTER TABLE public.source_nutrient_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.source_nutrient_mappings FROM anon;
REVOKE ALL ON public.source_nutrient_mappings FROM authenticated;
