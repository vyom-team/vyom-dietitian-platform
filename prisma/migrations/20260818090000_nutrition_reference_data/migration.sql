-- ===========================================================================
-- Phase 8A — nutrition reference data
--
-- The first GLOBAL data in the product. Every table before this one is
-- tenant-owned and scoped by organization_id; nothing here has an
-- organization_id at all, and that is deliberate. IFCT's protein figure for
-- toor dal is the same fact for every practice. Copying it per tenant would
-- multiply one dataset by the customer count and make a published correction
-- impossible to apply.
--
-- That inverts the security posture, so it is spelled out rather than implied:
--
--   READ    any clinical user of any practice (OWNER / DIETITIAN / SUPER_ADMIN)
--   WRITE   nobody through the browser, ever — import and admin code only
--
-- A cross-tenant read here is correct behaviour. A cross-tenant read on
-- clients or nutrition_assessments remains a breach, and none of the policies
-- below touch those tables.
--
-- Threat model:
--   * a dietitian or receptionist editing reference nutrition values
--   * a signed-out visitor reading the food database
--   * an import overwriting a previous dataset release's values
--   * a nutrient value existing with no traceable source
--   * "the source did not measure this" being recorded as zero
--
-- As always: RLS protects the browser → Supabase path, the Data Access Layer
-- protects the server path. See docs/security.md.
-- ===========================================================================

CREATE TYPE "data_use_status"            AS ENUM ('UNKNOWN', 'PERMITTED', 'RESTRICTED', 'PROHIBITED');
CREATE TYPE "source_permission_status"   AS ENUM ('DEVELOPMENT_ONLY', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "nutrition_source_status"    AS ENUM ('ACTIVE', 'SUPERSEDED', 'DISABLED');
CREATE TYPE "nutrient_category"          AS ENUM ('ENERGY', 'MACRONUTRIENT', 'MINERAL', 'VITAMIN', 'OTHER');
CREATE TYPE "nutrient_unit"              AS ENUM ('KCAL', 'KJ', 'G', 'MG', 'UG', 'IU');
CREATE TYPE "food_category"              AS ENUM ('GRAINS', 'PULSES', 'LEGUMES', 'VEGETABLES', 'FRUITS', 'DAIRY', 'NUTS', 'SEEDS', 'OILS', 'SPICES', 'BEVERAGES', 'MEAT', 'SEAFOOD', 'EGGS', 'PREPARED_FOODS', 'OTHER');
CREATE TYPE "food_type"                  AS ENUM ('RAW', 'COOKED', 'PROCESSED', 'PACKAGED', 'PREPARED', 'INGREDIENT');
CREATE TYPE "source_food_mapping_status" AS ENUM ('UNMAPPED', 'MAPPED', 'REVIEW_REQUIRED', 'REJECTED');
CREATE TYPE "unit_category"              AS ENUM ('WEIGHT', 'VOLUME', 'COUNT', 'HOUSEHOLD');
CREATE TYPE "dataset_import_status"      AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');


-- ---------------------------------------------------------------------------
-- nutrition_sources — who published the data, and under what terms
--
-- Licence status columns all default to "not established". Nothing in the
-- application may set commercial_use_status = 'PERMITTED' or
-- permission_status = 'APPROVED': those are human legal determinations, and
-- the default exists so silence is never mistaken for clearance.
-- ---------------------------------------------------------------------------
CREATE TABLE "nutrition_sources" (
    "id"                     UUID NOT NULL DEFAULT gen_random_uuid(),
    "code"                   VARCHAR(40) NOT NULL,
    "name"                   VARCHAR(200) NOT NULL,
    "organization"           VARCHAR(200),
    "country"                VARCHAR(2),
    "region"                 VARCHAR(100),
    "description"            TEXT,
    "source_url"             TEXT,
    "license_name"           VARCHAR(200),
    "license_url"            TEXT,
    "commercial_use_status"  "data_use_status" NOT NULL DEFAULT 'UNKNOWN',
    "redistribution_status"  "data_use_status" NOT NULL DEFAULT 'UNKNOWN',
    "permission_status"      "source_permission_status" NOT NULL DEFAULT 'DEVELOPMENT_ONLY',
    "attribution_required"   BOOLEAN NOT NULL DEFAULT true,
    "attribution_text"       TEXT,
    "status"                 "nutrition_source_status" NOT NULL DEFAULT 'ACTIVE',
    "metadata"               JSONB,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "nutrition_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nutrition_sources_code_key" ON "nutrition_sources"("code");
CREATE INDEX "nutrition_sources_status_idx" ON "nutrition_sources"("status");


-- ---------------------------------------------------------------------------
-- nutrition_source_versions — one published release
--
-- Split from the source because a new release must not corrupt existing
-- records. Nutrient values reference a *version*, so importing a later IFCT
-- leaves every IFCT 2017 value intact and still correctly attributed.
-- ---------------------------------------------------------------------------
CREATE TABLE "nutrition_source_versions" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id"   UUID NOT NULL,
    "version"     VARCHAR(40) NOT NULL,
    "released_on" DATE,
    "imported_at" TIMESTAMPTZ(6),
    "notes"       TEXT,
    "metadata"    JSONB,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "nutrition_source_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nutrition_source_versions_source_id_version_key"
  ON "nutrition_source_versions"("source_id", "version");
CREATE INDEX "nutrition_source_versions_source_id_idx"
  ON "nutrition_source_versions"("source_id");

ALTER TABLE "nutrition_source_versions"
  ADD CONSTRAINT "nutrition_source_versions_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "nutrition_sources"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- nutrients — the dictionary every measured value refers to
--
-- A dictionary rather than columns on foods. A wide table would need a
-- migration per nutrient, could not record which source supplied which value,
-- and would make "not measured" indistinguishable from zero.
-- ---------------------------------------------------------------------------
CREATE TABLE "nutrients" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "code"          VARCHAR(60) NOT NULL,
    "name"          VARCHAR(120) NOT NULL,
    "category"      "nutrient_category" NOT NULL,
    "unit"          "nutrient_unit" NOT NULL,
    "description"   TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active"     BOOLEAN NOT NULL DEFAULT true,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "nutrients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nutrients_code_key" ON "nutrients"("code");
CREATE INDEX "nutrients_category_display_order_idx"
  ON "nutrients"("category", "display_order");


-- ---------------------------------------------------------------------------
-- foods — the canonical entity the rest of Vyom talks to
--
-- Not an IFCT row and not an INDB row: those are source_foods that map onto
-- this. A dietitian picks "Toor Dal"; which dataset supplied its protein
-- figure is provenance, not identity.
--
-- No nutrient columns here by design.
-- ---------------------------------------------------------------------------
CREATE TABLE "foods" (
    "id"                       UUID NOT NULL DEFAULT gen_random_uuid(),
    "canonical_name"           VARCHAR(200) NOT NULL,
    "description"              TEXT,
    "category"                 "food_category" NOT NULL,
    "food_type"                "food_type" NOT NULL,
    "origin_source_version_id" UUID,
    "origin_source_food_id"    VARCHAR(80),
    "is_active"                BOOLEAN NOT NULL DEFAULT true,
    "metadata"                 JSONB,
    "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "foods_pkey" PRIMARY KEY ("id")
);

-- A canonical name that is blank or whitespace is not a name. Rejected here so
-- no import path can produce one, however the parser is written.
ALTER TABLE "foods"
  ADD CONSTRAINT "foods_canonical_name_not_blank"
  CHECK (length(btrim("canonical_name")) > 0);

-- Provenance is all-or-nothing: a food derived from a dataset records both
-- which release and which record, or neither. Half a trail is worse than none,
-- because it looks like a trail.
ALTER TABLE "foods"
  ADD CONSTRAINT "foods_origin_complete"
  CHECK (
    ("origin_source_version_id" IS NULL AND "origin_source_food_id" IS NULL)
    OR ("origin_source_version_id" IS NOT NULL AND "origin_source_food_id" IS NOT NULL)
  );

-- The importer's idempotency key: re-running an import finds the food it
-- created last time instead of inserting a second copy.
--
-- Postgres treats NULLs as distinct in a unique index, which is exactly right
-- here — hand-created foods have no origin and must not all collide on
-- (NULL, NULL).
CREATE UNIQUE INDEX "foods_origin_unique"
  ON "foods"("origin_source_version_id", "origin_source_food_id");

CREATE INDEX "foods_category_is_active_idx" ON "foods"("category", "is_active");
CREATE INDEX "foods_canonical_name_idx" ON "foods"("canonical_name");

-- RESTRICT: a source version that has produced foods cannot be deleted out
-- from under them. Provenance outlives convenience.
ALTER TABLE "foods"
  ADD CONSTRAINT "foods_origin_source_version_id_fkey"
  FOREIGN KEY ("origin_source_version_id") REFERENCES "nutrition_source_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- food_aliases — "Tur Dal", "Arhar Dal", "Pigeon Pea"
--
-- The foundation for search, not a translation system.
-- ---------------------------------------------------------------------------
CREATE TABLE "food_aliases" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id"       UUID NOT NULL,
    "alias"         VARCHAR(200) NOT NULL,
    "language_code" VARCHAR(8),
    "region"        VARCHAR(100),
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "food_aliases_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "food_aliases"
  ADD CONSTRAINT "food_aliases_alias_not_blank"
  CHECK (length(btrim("alias")) > 0);

CREATE UNIQUE INDEX "food_aliases_food_id_alias_key" ON "food_aliases"("food_id", "alias");
CREATE INDEX "food_aliases_alias_idx" ON "food_aliases"("alias");

-- CASCADE: an alias is part of the food, not a record in its own right.
ALTER TABLE "food_aliases"
  ADD CONSTRAINT "food_aliases_food_id_fkey"
  FOREIGN KEY ("food_id") REFERENCES "foods"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- food_nutrients — one measured value, from one release
--
-- THE MISSING/ZERO RULE, enforced structurally: a row exists only when the
-- source actually published a value. "Not measured" is the absence of a row.
-- Zero means the source measured it and found none — a different fact, and the
-- reason `value` is NOT NULL. There is no null-value row to confuse the two.
--
-- NUMERIC, never double precision: a reference figure that changes when it
-- round-trips through binary floating point is not reference data.
-- ---------------------------------------------------------------------------
CREATE TABLE "food_nutrients" (
    "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id"              UUID NOT NULL,
    "nutrient_id"          UUID NOT NULL,
    -- Required. A nutrition value with no traceable origin is precisely what
    -- this phase exists to prevent.
    "source_version_id"    UUID NOT NULL,
    "value"                NUMERIC(14,6) NOT NULL,
    "unit"                 "nutrient_unit" NOT NULL,
    -- What the value is per. Without this a figure is meaningless, and
    -- assuming 100 g for a source that publishes per-serving would corrupt
    -- every calculation later built on it.
    "basis_quantity"       NUMERIC(12,4) NOT NULL DEFAULT 100,
    "basis_unit_code"      VARCHAR(20) NOT NULL DEFAULT 'g',
    "source_nutrient_code" VARCHAR(80),
    "metadata"             JSONB,
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "food_nutrients_pkey" PRIMARY KEY ("id")
);

-- A negative quantity of a nutrient is not a measurement. Zero is allowed and
-- meaningful; below zero is a parse error that must not reach the table.
ALTER TABLE "food_nutrients"
  ADD CONSTRAINT "food_nutrients_value_non_negative"
  CHECK ("value" >= 0);

-- "Per 0 g" would make every derived quantity a division by zero.
ALTER TABLE "food_nutrients"
  ADD CONSTRAINT "food_nutrients_basis_positive"
  CHECK ("basis_quantity" > 0);

-- One value per nutrient per food per release. This is what makes an import
-- idempotent, and what lets IFCT 2017 and a later revision coexist on the same
-- food without either overwriting the other.
CREATE UNIQUE INDEX "food_nutrients_food_id_nutrient_id_source_version_id_key"
  ON "food_nutrients"("food_id", "nutrient_id", "source_version_id");

CREATE INDEX "food_nutrients_food_id_idx" ON "food_nutrients"("food_id");
CREATE INDEX "food_nutrients_nutrient_id_idx" ON "food_nutrients"("nutrient_id");
CREATE INDEX "food_nutrients_source_version_id_idx" ON "food_nutrients"("source_version_id");

-- CASCADE from the food (a value is part of it); RESTRICT on the dictionary
-- and the source version, which must survive everything referencing them.
ALTER TABLE "food_nutrients"
  ADD CONSTRAINT "food_nutrients_food_id_fkey"
  FOREIGN KEY ("food_id") REFERENCES "foods"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "food_nutrients"
  ADD CONSTRAINT "food_nutrients_nutrient_id_fkey"
  FOREIGN KEY ("nutrient_id") REFERENCES "nutrients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "food_nutrients"
  ADD CONSTRAINT "food_nutrients_source_version_id_fkey"
  FOREIGN KEY ("source_version_id") REFERENCES "nutrition_source_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- source_foods — what the file said, and what it maps to
--
-- The staging boundary between the dataset and Vyom's own model. Every row
-- read from a file lands here with its original identifier and name, whether
-- or not it could be tied to a canonical food.
--
-- Mapping is deterministic on the publisher's identifier. Nothing here matches
-- on name similarity: "Milk", "Milk, whole", and "Milk, toned" are different
-- foods with different nutrition, and merging them automatically would be a
-- clinical error. Ambiguity is parked at REVIEW_REQUIRED for a human.
-- ---------------------------------------------------------------------------
CREATE TABLE "source_foods" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_version_id" UUID NOT NULL,
    "external_id"       VARCHAR(80) NOT NULL,
    "external_name"     VARCHAR(300) NOT NULL,
    "external_category" VARCHAR(200),
    "food_id"           UUID,
    "mapping_status"    "source_food_mapping_status" NOT NULL DEFAULT 'UNMAPPED',
    "confidence"        NUMERIC(4,3),
    "notes"             TEXT,
    "raw_payload"       JSONB,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "source_foods_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "source_foods"
  ADD CONSTRAINT "source_foods_confidence_range"
  CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

-- MAPPED must actually point at something, and a status that is not MAPPED
-- must not carry a food. Otherwise "mapped" becomes a label rather than a fact.
ALTER TABLE "source_foods"
  ADD CONSTRAINT "source_foods_mapping_matches_food"
  CHECK (
    ("mapping_status" = 'MAPPED' AND "food_id" IS NOT NULL)
    OR ("mapping_status" <> 'MAPPED' AND "food_id" IS NULL)
  );

-- Duplicate detection: source + version + external id.
CREATE UNIQUE INDEX "source_foods_source_version_id_external_id_key"
  ON "source_foods"("source_version_id", "external_id");

CREATE INDEX "source_foods_mapping_status_idx" ON "source_foods"("mapping_status");
CREATE INDEX "source_foods_food_id_idx" ON "source_foods"("food_id");

ALTER TABLE "source_foods"
  ADD CONSTRAINT "source_foods_source_version_id_fkey"
  FOREIGN KEY ("source_version_id") REFERENCES "nutrition_source_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL: deactivating a canonical food should not destroy the record of
-- what the dataset contained.
ALTER TABLE "source_foods"
  ADD CONSTRAINT "source_foods_food_id_fkey"
  FOREIGN KEY ("food_id") REFERENCES "foods"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- units — the measurement vocabulary
--
-- The model only. Phase 8A establishes the vocabulary and the shape of a
-- conversion; the conversion engine belongs to the calculation phase, where it
-- can be built against published portion references rather than guessed.
-- ---------------------------------------------------------------------------
CREATE TABLE "units" (
    "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
    "code"                  VARCHAR(20) NOT NULL,
    "name"                  VARCHAR(80) NOT NULL,
    "category"              "unit_category" NOT NULL,
    "is_canonical"          BOOLEAN NOT NULL DEFAULT false,
    "requires_food_context" BOOLEAN NOT NULL DEFAULT false,
    "description"           TEXT,
    "is_active"             BOOLEAN NOT NULL DEFAULT true,
    "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "units_code_key" ON "units"("code");
CREATE INDEX "units_category_is_active_idx" ON "units"("category", "is_active");

-- Exactly one base unit per category — grams for WEIGHT, millilitres for
-- VOLUME. Two would make "convert to the canonical unit" ambiguous.
CREATE UNIQUE INDEX "units_one_canonical_per_category"
  ON "units"("category") WHERE "is_canonical";


-- ---------------------------------------------------------------------------
-- unit_conversions
--
-- Two kinds of row:
--   global   (food_id NULL)  1 kg = 1000 g. True everywhere.
--   specific (food_id set)   1 katori of cooked rice = N g. True only there.
--
-- No food-specific conversion is seeded by this migration. A household portion
-- weight without a published reference is a guess, and guessing would put
-- invented numbers underneath every calculation built on top later.
-- ---------------------------------------------------------------------------
CREATE TABLE "unit_conversions" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "from_unit_id" UUID NOT NULL,
    "to_unit_id"   UUID NOT NULL,
    "food_id"      UUID,
    "factor"       NUMERIC(16,8) NOT NULL,
    "source_note"  TEXT,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

-- A zero or negative factor would silently zero out or invert a quantity.
ALTER TABLE "unit_conversions"
  ADD CONSTRAINT "unit_conversions_factor_positive"
  CHECK ("factor" > 0);

-- A unit converted to itself is either noise or a factor waiting to be wrong.
ALTER TABLE "unit_conversions"
  ADD CONSTRAINT "unit_conversions_distinct_units"
  CHECK ("from_unit_id" <> "to_unit_id");

CREATE UNIQUE INDEX "unit_conversions_unique"
  ON "unit_conversions"("from_unit_id", "to_unit_id", "food_id");

-- The composite index above does not constrain global rows: Postgres treats
-- NULLs as distinct, so (g, kg, NULL) could be inserted twice and the two
-- factors could disagree. This partial index is what actually enforces one
-- global conversion per unit pair.
CREATE UNIQUE INDEX "unit_conversions_global_unique"
  ON "unit_conversions"("from_unit_id", "to_unit_id") WHERE "food_id" IS NULL;

CREATE INDEX "unit_conversions_food_id_idx" ON "unit_conversions"("food_id");

ALTER TABLE "unit_conversions"
  ADD CONSTRAINT "unit_conversions_from_unit_id_fkey"
  FOREIGN KEY ("from_unit_id") REFERENCES "units"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "unit_conversions"
  ADD CONSTRAINT "unit_conversions_to_unit_id_fkey"
  FOREIGN KEY ("to_unit_id") REFERENCES "units"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "unit_conversions"
  ADD CONSTRAINT "unit_conversions_food_id_fkey"
  FOREIGN KEY ("food_id") REFERENCES "foods"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- dataset_imports — the manifest of one ingestion run
--
-- Written before the work starts and updated when it ends, so a crashed import
-- leaves a RUNNING row rather than no evidence at all.
--
-- Every count in this table is real. Nothing writes an expected or estimated
-- figure, which is what makes the data-quality report trustworthy.
-- ---------------------------------------------------------------------------
CREATE TABLE "dataset_imports" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_version_id" UUID NOT NULL,
    "status"            "dataset_import_status" NOT NULL DEFAULT 'RUNNING',
    "started_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "completed_at"      TIMESTAMPTZ(6),
    -- File name only, never an absolute path: a machine's directory layout is
    -- not something to persist, and it can leak a username.
    "input_file"        VARCHAR(300),
    "input_checksum"    VARCHAR(64),
    "records_read"      INTEGER NOT NULL DEFAULT 0,
    "records_imported"  INTEGER NOT NULL DEFAULT 0,
    "records_skipped"   INTEGER NOT NULL DEFAULT 0,
    "records_failed"    INTEGER NOT NULL DEFAULT 0,
    "warnings"          JSONB,
    "errors"            JSONB,
    "metadata"          JSONB,
    "dry_run"           BOOLEAN NOT NULL DEFAULT false,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "dataset_imports_pkey" PRIMARY KEY ("id")
);

-- Negative counts would mean the reporting arithmetic is broken, and a report
-- nobody can trust is worse than no report.
ALTER TABLE "dataset_imports"
  ADD CONSTRAINT "dataset_imports_counts_non_negative"
  CHECK (
    "records_read" >= 0 AND "records_imported" >= 0
    AND "records_skipped" >= 0 AND "records_failed" >= 0
  );

-- A finished run records when it finished; a running one has not finished.
ALTER TABLE "dataset_imports"
  ADD CONSTRAINT "dataset_imports_completed_at_matches_status"
  CHECK (
    ("status" = 'RUNNING' AND "completed_at" IS NULL)
    OR ("status" <> 'RUNNING' AND "completed_at" IS NOT NULL)
  );

CREATE INDEX "dataset_imports_source_version_id_started_at_idx"
  ON "dataset_imports"("source_version_id", "started_at" DESC);
CREATE INDEX "dataset_imports_status_idx" ON "dataset_imports"("status");

ALTER TABLE "dataset_imports"
  ADD CONSTRAINT "dataset_imports_source_version_id_fkey"
  FOREIGN KEY ("source_version_id") REFERENCES "nutrition_source_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Row Level Security
--
-- A NEW SHAPE. Every helper before this one answers "which organizations may
-- this user see?" and returns a set of ids, because every table before this
-- one is tenant-owned. Reference data belongs to no organization, so the
-- question is different: "may this user read clinical reference data at all?"
-- — a boolean.
--
-- That means these policies deliberately carry NO organization_id predicate.
-- It is not an omission and it does not weaken tenant isolation: no policy
-- below touches clients, nutrition_assessments, or any other tenant table, and
-- those remain scoped exactly as Phases 3–7 left them.
--
-- Writes: there is no INSERT, UPDATE, or DELETE policy and no write grant on
-- any table here. A dietitian cannot edit IFCT's protein figure through the
-- browser by any path. Imports run as the table owner, through server-side
-- code that has already passed the Data Access Layer.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Clinical-user predicate
--
-- Same construction as the Phase 3 and Phase 7 helpers: STABLE so it evaluates
-- once per statement, SECURITY DEFINER so it can read organization_members
-- without re-entering that table's own policy, and an empty search_path so no
-- object can be shadowed by a caller-controlled schema.
--
-- Returns a boolean rather than a set of organization ids, because reference
-- data has no organization to compare against. Membership of any active
-- practice in a clinical role is the whole test.
--
-- RECEPTIONIST is excluded for consistency with the clinical boundary drawn in
-- Phase 7. Reference nutrition data is not health information about a person
-- and would be harmless for them to read — but the food database exists to
-- serve clinical work, a receptionist has no workflow that reaches it, and one
-- definition of "clinical user" is easier to reason about than two.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vyom_private.is_clinical_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.user_profiles p ON p.id = m.user_id
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE p.auth_user_id = (SELECT auth.uid())
      AND m.status = 'ACTIVE'
      AND o.status = 'ACTIVE'
      AND m.role IN ('OWNER', 'DIETITIAN', 'SUPER_ADMIN')
  );
$$;

REVOKE ALL ON FUNCTION vyom_private.is_clinical_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vyom_private.is_clinical_user() TO authenticated;


-- ---------------------------------------------------------------------------
-- Readable reference tables
--
-- SELECT only, and only for clinical users. `anon` gets nothing: the food
-- database is a product surface, not public data, and some of the datasets
-- behind it carry redistribution restrictions that have not been reviewed.
-- ---------------------------------------------------------------------------

ALTER TABLE public.nutrition_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nutrition_sources FROM anon;
REVOKE ALL ON public.nutrition_sources FROM authenticated;
GRANT SELECT ON public.nutrition_sources TO authenticated;
CREATE POLICY nutrition_sources_select_clinical
  ON public.nutrition_sources FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());

ALTER TABLE public.nutrition_source_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nutrition_source_versions FROM anon;
REVOKE ALL ON public.nutrition_source_versions FROM authenticated;
GRANT SELECT ON public.nutrition_source_versions TO authenticated;
CREATE POLICY nutrition_source_versions_select_clinical
  ON public.nutrition_source_versions FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());

ALTER TABLE public.nutrients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nutrients FROM anon;
REVOKE ALL ON public.nutrients FROM authenticated;
GRANT SELECT ON public.nutrients TO authenticated;
CREATE POLICY nutrients_select_clinical
  ON public.nutrients FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());

ALTER TABLE public.foods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.foods FROM anon;
REVOKE ALL ON public.foods FROM authenticated;
GRANT SELECT ON public.foods TO authenticated;
CREATE POLICY foods_select_clinical
  ON public.foods FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());

ALTER TABLE public.food_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_aliases FROM anon;
REVOKE ALL ON public.food_aliases FROM authenticated;
GRANT SELECT ON public.food_aliases TO authenticated;
CREATE POLICY food_aliases_select_clinical
  ON public.food_aliases FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());

ALTER TABLE public.food_nutrients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_nutrients FROM anon;
REVOKE ALL ON public.food_nutrients FROM authenticated;
GRANT SELECT ON public.food_nutrients TO authenticated;
CREATE POLICY food_nutrients_select_clinical
  ON public.food_nutrients FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.units FROM anon;
REVOKE ALL ON public.units FROM authenticated;
GRANT SELECT ON public.units TO authenticated;
CREATE POLICY units_select_clinical
  ON public.units FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());

ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_conversions FROM anon;
REVOKE ALL ON public.unit_conversions FROM authenticated;
GRANT SELECT ON public.unit_conversions TO authenticated;
CREATE POLICY unit_conversions_select_clinical
  ON public.unit_conversions FOR SELECT TO authenticated
  USING (vyom_private.is_clinical_user());


-- ---------------------------------------------------------------------------
-- Ingestion tables — no browser access at all
--
-- RLS enabled with ZERO policies and ZERO grants. In Postgres that is a
-- complete denial for any non-owner role: with RLS on, a table with no
-- applicable policy returns no rows and accepts no writes.
--
-- This is intentional rather than an oversight. `source_foods` holds raw
-- dataset payloads whose redistribution terms have not been reviewed, and
-- `dataset_imports` is operational telemetry — file names, checksums, error
-- text. Neither is something a practitioner has any reason to read, and the
-- raw payloads in particular must not become a way to extract a dataset
-- through the API. Server-side code reaches them through Prisma as the table
-- owner; a future Super Admin surface will read them the same way, behind the
-- Data Access Layer.
-- ---------------------------------------------------------------------------

ALTER TABLE public.source_foods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.source_foods FROM anon;
REVOKE ALL ON public.source_foods FROM authenticated;

ALTER TABLE public.dataset_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dataset_imports FROM anon;
REVOKE ALL ON public.dataset_imports FROM authenticated;
