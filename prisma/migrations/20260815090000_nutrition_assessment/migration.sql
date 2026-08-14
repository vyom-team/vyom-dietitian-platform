-- ===========================================================================
-- Phase 7 — nutrition assessment
--
-- One table holding health information: conditions, medications, allergies,
-- and clinical notes. This is the most sensitive data in the product so far,
-- and its access boundary is narrower than every table before it.
--
-- Threat model:
--   * a member of practice A reading practice B's assessments
--   * a RECEPTIONIST reading health data they have no clinical reason to see
--   * an assessment being created against another practice's client or member
--   * an assessment's organization drifting out of step with its client's
--
-- As always: RLS protects the browser → Supabase path, the Data Access Layer
-- protects the server path. See docs/security.md.
-- ===========================================================================

CREATE TYPE "assessment_type"   AS ENUM ('INITIAL', 'FOLLOW_UP');
CREATE TYPE "assessment_status" AS ENUM ('DRAFT', 'COMPLETED');
CREATE TYPE "activity_level"    AS ENUM ('SEDENTARY', 'LIGHTLY_ACTIVE', 'MODERATELY_ACTIVE', 'VERY_ACTIVE');
CREATE TYPE "diet_type"         AS ENUM ('VEGETARIAN', 'EGGETARIAN', 'NON_VEGETARIAN', 'VEGAN', 'OTHER');
CREATE TYPE "primary_goal"      AS ENUM ('WEIGHT_LOSS', 'WEIGHT_GAIN', 'WEIGHT_MAINTENANCE', 'MUSCLE_GAIN', 'GENERAL_WELLNESS', 'CONDITION_MANAGEMENT', 'OTHER');


-- ---------------------------------------------------------------------------
-- Clinical-role helper
--
-- Narrower than `current_staff_organization_ids`, which includes
-- RECEPTIONIST. Health data is restricted to roles with a clinical reason to
-- read it: OWNER, DIETITIAN, and the platform role.
--
-- Same shape as the Phase 3 helpers: STABLE so it evaluates once per statement,
-- SECURITY DEFINER so it can read organization_members without re-entering that
-- table's own policy, and an empty search_path so no object can be shadowed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vyom_private.current_clinical_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.organization_id
  FROM public.organization_members m
  JOIN public.user_profiles p ON p.id = m.user_id
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE p.auth_user_id = (SELECT auth.uid())
    AND m.status = 'ACTIVE'
    AND o.status = 'ACTIVE'
    AND m.role IN ('OWNER', 'DIETITIAN', 'SUPER_ADMIN');
$$;

REVOKE ALL ON FUNCTION vyom_private.current_clinical_organization_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vyom_private.current_clinical_organization_ids() TO authenticated;


-- ---------------------------------------------------------------------------
-- nutrition_assessments
-- ---------------------------------------------------------------------------
CREATE TABLE "nutrition_assessments" (
    "id"                     UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Denormalised from the client so policies and queries scope without a
    -- join. A trigger below keeps it honest.
    "organization_id"        UUID NOT NULL,
    "client_id"              UUID NOT NULL,
    "created_by_member_id"   UUID NOT NULL,

    "assessment_type"        "assessment_type" NOT NULL,
    "status"                 "assessment_status" NOT NULL DEFAULT 'DRAFT',
    -- DATE: the consultation happened on a calendar day, not at an instant.
    -- Storing it as a timestamp would shift it across midnight for some users.
    "assessment_date"        DATE NOT NULL,

    -- NUMERIC, not double precision. Binary floating point cannot represent
    -- 70.1 exactly, and a recorded measurement must survive a round trip.
    "height_cm"              NUMERIC(5,1),
    "weight_kg"              NUMERIC(5,1),
    -- BMI is deliberately absent: it is derived from the two columns above, and
    -- a stored copy can drift out of step the moment either is corrected.

    "medical_history"        TEXT,
    "health_conditions"      TEXT,
    "current_medications"    TEXT,
    -- Separate from food preferences: an allergy is a safety constraint, a
    -- dislike is a preference, and a future meal planner must not confuse them.
    "allergies_intolerances" TEXT,

    "activity_level"         "activity_level",
    "exercise_frequency"     VARCHAR(200),
    "occupation"             VARCHAR(200),
    "sleep_pattern"          VARCHAR(200),
    "water_litres_per_day"   NUMERIC(3,1),

    "diet_type"              "diet_type",
    "diet_type_other"        VARCHAR(120),
    "food_preferences"       TEXT,
    "foods_disliked"         TEXT,
    "foods_avoided"          TEXT,
    "dietary_restrictions"   TEXT,

    "primary_goal"           "primary_goal",
    "primary_goal_other"     VARCHAR(120),
    "goal_notes"             TEXT,

    "assessment_notes"       TEXT,

    "completed_at"           TIMESTAMPTZ(6),
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "nutrition_assessments_pkey" PRIMARY KEY ("id")
);

-- Measurements must be physically possible. A negative or zero height would
-- also make BMI undefined, so the database refuses it outright rather than
-- relying on every caller to validate.
ALTER TABLE "nutrition_assessments"
  ADD CONSTRAINT "nutrition_assessments_height_range"
  CHECK ("height_cm" IS NULL OR ("height_cm" > 30 AND "height_cm" <= 260));

ALTER TABLE "nutrition_assessments"
  ADD CONSTRAINT "nutrition_assessments_weight_range"
  CHECK ("weight_kg" IS NULL OR ("weight_kg" > 1 AND "weight_kg" <= 500));

ALTER TABLE "nutrition_assessments"
  ADD CONSTRAINT "nutrition_assessments_water_range"
  CHECK ("water_litres_per_day" IS NULL OR ("water_litres_per_day" >= 0 AND "water_litres_per_day" <= 20));

-- A completed assessment must record when it was completed, and a draft must
-- not claim to have been. Keeps the two fields from contradicting each other.
ALTER TABLE "nutrition_assessments"
  ADD CONSTRAINT "nutrition_assessments_completed_at_matches_status"
  CHECK (
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
    OR ("status" = 'DRAFT' AND "completed_at" IS NULL)
  );

-- The history query: one client's assessments, newest first.
CREATE INDEX "nutrition_assessments_client_id_assessment_date_idx"
  ON "nutrition_assessments"("client_id", "assessment_date" DESC);

CREATE INDEX "nutrition_assessments_organization_id_status_idx"
  ON "nutrition_assessments"("organization_id", "status");

CREATE INDEX "nutrition_assessments_organization_id_assessment_date_idx"
  ON "nutrition_assessments"("organization_id", "assessment_date");

CREATE INDEX "nutrition_assessments_created_by_member_id_idx"
  ON "nutrition_assessments"("created_by_member_id");

-- RESTRICT throughout. An assessment is a clinical record: archiving a client
-- leaves it untouched, and nothing referenced by it may be deleted out from
-- under it.
ALTER TABLE "nutrition_assessments"
  ADD CONSTRAINT "nutrition_assessments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nutrition_assessments"
  ADD CONSTRAINT "nutrition_assessments_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nutrition_assessments"
  ADD CONSTRAINT "nutrition_assessments_created_by_member_id_fkey"
  FOREIGN KEY ("created_by_member_id") REFERENCES "organization_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Read-only for the browser, and only for clinical roles. There is no INSERT,
-- UPDATE, or DELETE policy and no write grant: every mutation goes through
-- server code that has already passed the Data Access Layer.
--
-- Note the helper: `current_clinical_organization_ids`, not
-- `current_staff_organization_ids`. A RECEPTIONIST can manage the client record
-- and cannot read a single field of this table.
-- ---------------------------------------------------------------------------

ALTER TABLE public.nutrition_assessments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nutrition_assessments FROM anon;
REVOKE ALL ON public.nutrition_assessments FROM authenticated;

GRANT SELECT ON public.nutrition_assessments TO authenticated;

CREATE POLICY nutrition_assessments_select_clinical
  ON public.nutrition_assessments
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT vyom_private.current_clinical_organization_ids()));


-- ---------------------------------------------------------------------------
-- Consistency trigger
--
-- `organization_id` is denormalised from the client, and two independent
-- foreign keys cannot express "these must agree". Without this, a bug could
-- file an assessment under practice A against a client belonging to practice B
-- — and the RLS policy, which scopes on organization_id, would happily show it
-- to the wrong practice.
--
-- The trigger also verifies the recording member belongs to the same practice,
-- which is what makes cross-practice attribution impossible.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_assessment_same_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  client_org UUID;
  member_org UUID;
BEGIN
  SELECT organization_id INTO client_org
    FROM public.clients WHERE id = NEW.client_id;

  SELECT organization_id INTO member_org
    FROM public.organization_members WHERE id = NEW.created_by_member_id;

  IF client_org IS NULL OR client_org <> NEW.organization_id THEN
    RAISE EXCEPTION
      'assessment organization must match its client''s organization'
      USING ERRCODE = 'check_violation';
  END IF;

  IF member_org IS NULL OR member_org <> NEW.organization_id THEN
    RAISE EXCEPTION
      'assessment author must belong to the same organization'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assessment_same_organization ON public.nutrition_assessments;

CREATE TRIGGER assessment_same_organization
  BEFORE INSERT OR UPDATE OF organization_id, client_id, created_by_member_id
  ON public.nutrition_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_assessment_same_organization();
