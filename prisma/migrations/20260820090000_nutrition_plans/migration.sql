-- ===========================================================================
-- Phase 8E — nutrition plans
--
-- Stores what a dietitian CHOSE: which foods, which servings, what quantities.
-- Stores no nutrient total, no percentage, and no target comparison — every one
-- of those is derived from these inputs plus a source release, and a stored
-- copy goes stale the moment a dataset is corrected or a reference is licensed.
--
-- Tenant-owned clinical data, unlike the global food and reference tables.
-- ===========================================================================

CREATE TYPE "meal_slot" AS ENUM (
  'BREAKFAST', 'MID_MORNING', 'LUNCH', 'EVENING_SNACK', 'DINNER'
);


-- ---------------------------------------------------------------------------
-- nutrition_plans
-- ---------------------------------------------------------------------------

CREATE TABLE "nutrition_plans" (
  "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"      UUID NOT NULL,
  "client_id"            UUID NOT NULL,
  "created_by_member_id" UUID NOT NULL,
  "assessment_id"        UUID,
  "name"                 VARCHAR(120) NOT NULL,
  "plan_date"            DATE NOT NULL,
  "notes"                TEXT,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "nutrition_plans_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "nutrition_plans"
  ADD CONSTRAINT "nutrition_plans_name_not_blank"
  CHECK (length(btrim(name)) > 0);

CREATE INDEX "nutrition_plans_client_id_plan_date_idx"
  ON "nutrition_plans"("client_id", "plan_date" DESC);
CREATE INDEX "nutrition_plans_organization_id_idx"
  ON "nutrition_plans"("organization_id");
CREATE INDEX "nutrition_plans_created_by_member_id_idx"
  ON "nutrition_plans"("created_by_member_id");
CREATE INDEX "nutrition_plans_assessment_id_idx"
  ON "nutrition_plans"("assessment_id");

ALTER TABLE "nutrition_plans"
  ADD CONSTRAINT "nutrition_plans_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nutrition_plans"
  ADD CONSTRAINT "nutrition_plans_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nutrition_plans"
  ADD CONSTRAINT "nutrition_plans_created_by_member_id_fkey"
  FOREIGN KEY ("created_by_member_id") REFERENCES "organization_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nutrition_plans"
  ADD CONSTRAINT "nutrition_plans_assessment_id_fkey"
  FOREIGN KEY ("assessment_id") REFERENCES "nutrition_assessments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- nutrition_plan_items
-- ---------------------------------------------------------------------------

CREATE TABLE "nutrition_plan_items" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id"           UUID NOT NULL,
  "meal_slot"         "meal_slot" NOT NULL,
  "position"          INTEGER NOT NULL DEFAULT 0,
  "food_id"           UUID NOT NULL,
  "serving_id"        UUID,
  "quantity"          DECIMAL(12,4) NOT NULL,
  "unit"              VARCHAR(20) NOT NULL,
  "source_version_id" UUID,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "nutrition_plan_items_pkey" PRIMARY KEY ("id")
);

-- A zero or negative quantity is not an intake of nothing; it is an item that
-- should not be in the plan. The Phase 8C engine rejects it too, and this makes
-- the database refuse to hold one in the first place.
ALTER TABLE "nutrition_plan_items"
  ADD CONSTRAINT "nutrition_plan_items_quantity_positive"
  CHECK (quantity > 0);

-- Only the two units the calculation engine supports. Kept as a CHECK rather
-- than a database enum so there is one definition of the vocabulary — the
-- engine's — instead of two that could drift apart.
ALTER TABLE "nutrition_plan_items"
  ADD CONSTRAINT "nutrition_plan_items_unit_supported"
  CHECK (unit IN ('GRAM', 'SERVING'));

-- A serving-based quantity needs a serving; a gram quantity must not carry one.
-- Without this, an item could claim "2 servings" with nothing to convert, and
-- the engine would reject it on every read instead of at the point of entry.
ALTER TABLE "nutrition_plan_items"
  ADD CONSTRAINT "nutrition_plan_items_serving_matches_unit"
  CHECK (
    (unit = 'SERVING' AND serving_id IS NOT NULL)
    OR
    (unit = 'GRAM' AND serving_id IS NULL)
  );

ALTER TABLE "nutrition_plan_items"
  ADD CONSTRAINT "nutrition_plan_items_position_non_negative"
  CHECK (position >= 0);

CREATE INDEX "nutrition_plan_items_plan_id_meal_slot_position_idx"
  ON "nutrition_plan_items"("plan_id", "meal_slot", "position");
CREATE INDEX "nutrition_plan_items_food_id_idx"
  ON "nutrition_plan_items"("food_id");

-- Cascade from the plan: an item has no meaning without one. Restrict on food
-- and serving: a plan must never lose its meaning because reference data was
-- reorganised.
ALTER TABLE "nutrition_plan_items"
  ADD CONSTRAINT "nutrition_plan_items_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "nutrition_plans"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nutrition_plan_items"
  ADD CONSTRAINT "nutrition_plan_items_food_id_fkey"
  FOREIGN KEY ("food_id") REFERENCES "foods"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nutrition_plan_items"
  ADD CONSTRAINT "nutrition_plan_items_serving_id_fkey"
  FOREIGN KEY ("serving_id") REFERENCES "food_servings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nutrition_plan_items"
  ADD CONSTRAINT "nutrition_plan_items_source_version_id_fkey"
  FOREIGN KEY ("source_version_id") REFERENCES "nutrition_source_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Row Level Security
--
-- Same posture as nutrition_assessments, and for the same reason: a plan is
-- built from a client's clinical targets and is clinical data by audience.
--
-- Note the helper — `current_clinical_organization_ids`, not the staff one. A
-- RECEPTIONIST may manage the client record and cannot read a single row here.
--
-- SELECT only for the browser. Writes go through Server Actions that have
-- already passed the Data Access Layer.
-- ===========================================================================

ALTER TABLE public.nutrition_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nutrition_plans FROM anon;
REVOKE ALL ON public.nutrition_plans FROM authenticated;
GRANT SELECT ON public.nutrition_plans TO authenticated;
CREATE POLICY nutrition_plans_select_clinical
  ON public.nutrition_plans
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT vyom_private.current_clinical_organization_ids()));

-- Items carry no organization_id of their own: they are meaningless outside
-- their plan, and duplicating the column would create a second thing to keep
-- consistent. The policy reaches through the plan instead.
ALTER TABLE public.nutrition_plan_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nutrition_plan_items FROM anon;
REVOKE ALL ON public.nutrition_plan_items FROM authenticated;
GRANT SELECT ON public.nutrition_plan_items TO authenticated;
CREATE POLICY nutrition_plan_items_select_clinical
  ON public.nutrition_plan_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_items.plan_id
        AND p.organization_id IN (SELECT vyom_private.current_clinical_organization_ids())
    )
  );


-- ===========================================================================
-- Consistency trigger
--
-- `organization_id` is denormalised from the client, and two independent
-- foreign keys cannot express "these must agree". Without this a bug could file
-- a plan under practice A for a client of practice B — and the RLS policy,
-- which scopes on organization_id, would show it to the wrong practice.
--
-- Mirrors assert_assessment_same_organization, plus one check of its own: a
-- plan must not be measured against another client's targets.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.assert_plan_same_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  client_org        UUID;
  member_org        UUID;
  assessment_client UUID;
BEGIN
  SELECT organization_id INTO client_org
    FROM public.clients WHERE id = NEW.client_id;

  SELECT organization_id INTO member_org
    FROM public.organization_members WHERE id = NEW.created_by_member_id;

  IF client_org IS NULL OR client_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'nutrition_plans.organization_id must match the client organization';
  END IF;

  IF member_org IS NULL OR member_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'nutrition_plans.created_by_member_id must belong to the same organization';
  END IF;

  IF NEW.assessment_id IS NOT NULL THEN
    SELECT client_id INTO assessment_client
      FROM public.nutrition_assessments WHERE id = NEW.assessment_id;

    IF assessment_client IS NULL OR assessment_client <> NEW.client_id THEN
      RAISE EXCEPTION 'nutrition_plans.assessment_id must belong to the same client';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER nutrition_plans_same_organization
  BEFORE INSERT OR UPDATE ON public.nutrition_plans
  FOR EACH ROW EXECUTE FUNCTION public.assert_plan_same_organization();
