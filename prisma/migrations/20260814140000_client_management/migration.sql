-- ===========================================================================
-- Phase 6 — client management
--
-- Two tables plus a per-practice client-number counter.
--
-- Threat model:
--   * a member of practice A reading, editing, or archiving practice B's clients
--   * a client being assigned to a staff member of a different practice
--   * two concurrent creations receiving the same client number
--   * a dietitian seeing clients they are not responsible for
--
-- As always: RLS protects the browser → Supabase path, and the Data Access
-- Layer protects the server path, because Prisma connects as the table owner
-- and bypasses these policies. See docs/security.md.
-- ===========================================================================

CREATE TYPE "client_status" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "client_gender" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED');

-- ---------------------------------------------------------------------------
-- Client-number counter
--
-- A counter on the tenant row, not `count(clients) + 1`. The count approach
-- races under concurrent creation and silently reuses numbers after an archive.
-- `UPDATE ... RETURNING` takes a row lock, so simultaneous creations serialise.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS next_client_number INTEGER NOT NULL DEFAULT 1;


-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
CREATE TABLE "clients" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "client_number"   VARCHAR(20) NOT NULL,
    "first_name"      VARCHAR(80) NOT NULL,
    "last_name"       VARCHAR(80) NOT NULL,
    "email"           VARCHAR(255),
    "phone"           VARCHAR(32),
    -- DATE, not timestamptz: a birth date has no time and no zone. Storing it
    -- as a timestamp shifts it across midnight for some users.
    "date_of_birth"   DATE,
    "gender"          "client_gender",
    "address_line"    VARCHAR(200),
    "city"            VARCHAR(100),
    "state"           VARCHAR(100),
    "postal_code"     VARCHAR(20),
    "country"         VARCHAR(2),
    "status"          "client_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at"     TIMESTAMPTZ(6),
    "created_by_id"   UUID,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- Unique per practice rather than globally: a shared sequence would let one
-- practice infer another's client volume from the gaps in its own numbers.
CREATE UNIQUE INDEX "clients_organization_id_client_number_key"
  ON "clients"("organization_id", "client_number");

-- The list query.
CREATE INDEX "clients_organization_id_status_idx"
  ON "clients"("organization_id", "status");

-- Default ordering, newest first within a practice.
CREATE INDEX "clients_organization_id_created_at_idx"
  ON "clients"("organization_id", "created_at");

-- Name search and alphabetical ordering.
CREATE INDEX "clients_organization_id_last_name_first_name_idx"
  ON "clients"("organization_id", "last_name", "first_name");

-- RESTRICT, not CASCADE. Deleting a practice must not silently destroy client
-- records; archival is the supported path and clinical data carries retention
-- obligations.
ALTER TABLE "clients"
  ADD CONSTRAINT "clients_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A staff member leaving must not take client records with them.
ALTER TABLE "clients"
  ADD CONSTRAINT "clients_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "user_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- client_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE "client_assignments" (
    "id"                     UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id"              UUID NOT NULL,
    "organization_member_id" UUID NOT NULL,
    "ended_at"               TIMESTAMPTZ(6),
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "client_assignments_pkey" PRIMARY KEY ("id")
);

-- "Which clients am I responsible for" — the dietitian's list query.
CREATE INDEX "client_assignments_organization_member_id_ended_at_idx"
  ON "client_assignments"("organization_member_id", "ended_at");

CREATE INDEX "client_assignments_client_id_ended_at_idx"
  ON "client_assignments"("client_id", "ended_at");

-- At most one *active* assignment per client, enforced by a partial unique
-- index. Ended rows are exempt, so reassignment history accumulates freely
-- while the current owner of a client stays unambiguous.
--
-- MAINTENANCE NOTE: Prisma's schema language cannot express a partial index, so
-- this object is invisible to `schema.prisma`. `prisma migrate dev` may
-- therefore propose dropping it when generating a future migration — review any
-- generated SQL that touches client_assignments and keep this index. It is the
-- only thing preventing two simultaneous "active" dietitians on one client.
CREATE UNIQUE INDEX "client_assignments_one_active_per_client"
  ON "client_assignments"("client_id")
  WHERE "ended_at" IS NULL;

-- Assignments are meaningless without their client, and a client's assignment
-- history has no independent value, so CASCADE is correct here.
ALTER TABLE "client_assignments"
  ADD CONSTRAINT "client_assignments_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: assignment history records who was responsible for a client, and
-- must survive a membership being cleaned up.
ALTER TABLE "client_assignments"
  ADD CONSTRAINT "client_assignments_organization_member_id_fkey"
  FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Read-only for the browser. There is no INSERT, UPDATE, or DELETE policy and
-- no write grant, so the Supabase client cannot create or modify a client
-- record by any path. Every mutation goes through server code that has already
-- passed the Data Access Layer.
--
-- Reads are scoped to organization membership. `CLIENT`-role members are
-- excluded: the client portal is a later phase with its own, much narrower
-- access rules, and letting a client-role member read the staff client list
-- would expose every other client of the practice.
-- ---------------------------------------------------------------------------

ALTER TABLE public.clients            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.clients            FROM anon;
REVOKE ALL ON public.client_assignments FROM anon;
REVOKE ALL ON public.clients            FROM authenticated;
REVOKE ALL ON public.client_assignments FROM authenticated;

GRANT SELECT ON public.clients            TO authenticated;
GRANT SELECT ON public.client_assignments TO authenticated;

CREATE POLICY clients_select_staff ON public.clients
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT vyom_private.current_staff_organization_ids()));

-- Reached through the client, so the same organization scope applies. Written
-- as an EXISTS against clients rather than a second membership lookup, which
-- keeps the check on the indexed client_id.
CREATE POLICY client_assignments_select_staff ON public.client_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = client_assignments.client_id
        AND c.organization_id IN (SELECT vyom_private.current_staff_organization_ids())
    )
  );


-- ---------------------------------------------------------------------------
-- Cross-organization assignment guard
--
-- A trigger, because no foreign key can express "the member and the client must
-- belong to the same organization" — they are two independent references.
--
-- The Data Access Layer already verifies both sides before writing. This is the
-- backstop that makes the invalid state unrepresentable regardless of which
-- code path attempts it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_client_assignment_same_organization()
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
    FROM public.organization_members WHERE id = NEW.organization_member_id;

  IF client_org IS NULL OR member_org IS NULL OR client_org <> member_org THEN
    RAISE EXCEPTION
      'client assignment must stay within one organization'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_assignment_same_organization ON public.client_assignments;

CREATE TRIGGER client_assignment_same_organization
  BEFORE INSERT OR UPDATE OF client_id, organization_member_id
  ON public.client_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_client_assignment_same_organization();
