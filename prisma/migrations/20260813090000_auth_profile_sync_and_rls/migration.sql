-- ===========================================================================
-- Phase 3 — profile synchronisation and Row Level Security
--
-- Two concerns, one migration because the RLS policies depend on the profile
-- linkage the trigger maintains.
--
-- Threat model this defends against:
--   * a signed-in user reading another organization's rows
--   * a signed-in user promoting themselves to OWNER or SUPER_ADMIN
--   * a signed-in user editing someone else's profile
--   * a client-role user altering subscription state
--   * an anonymous visitor reading anything at all
--
-- Note on Prisma: the application's Prisma connection owns these tables and
-- therefore BYPASSES the policies below. RLS is the safety net for everything
-- reached through the Supabase client (PostgREST, browser, realtime). Server
-- code must still authorize through src/lib/auth/dal.ts. See docs/security.md.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Database-level defaults for updated_at
--
-- Prisma's `@updatedAt` is applied by the *client*, so the column was NOT NULL
-- with no database default. Any writer that is not Prisma — the trigger below,
-- a manual fix-up, a future Supabase function — would fail with a not-null
-- violation. Registration would have broken the moment the trigger fired.
--
-- Giving the column a database default makes the table correct on its own terms
-- rather than only when accessed through one particular client.
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations        ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE public.user_profiles        ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE public.organization_members ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE public.subscriptions        ALTER COLUMN updated_at SET DEFAULT NOW();


-- ---------------------------------------------------------------------------
-- 1. Profile synchronisation
--
-- Strategy: a database trigger on auth.users, not client-side profile creation.
--
-- Why: the browser must never be able to create a profile row for an arbitrary
-- auth user. A trigger runs inside the same transaction that creates the auth
-- user, which removes the registration race entirely — there is no window in
-- which a session exists without a profile.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- Empty search_path: every object below is schema-qualified, so a malicious
-- object in a user-controlled schema cannot be resolved instead of ours.
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (auth_user_id, email, full_name)
  VALUES (
    NEW.id,
    LOWER(NEW.email),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), '')
  )
  -- A profile may already exist because the person was invited to an
  -- organization before they signed up. Link it to the new auth user rather
  -- than creating a duplicate identity for the same email.
  ON CONFLICT (email) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        full_name    = COALESCE(public.user_profiles.full_name, EXCLUDED.full_name),
        updated_at   = NOW()
    -- Only adopt an unclaimed profile. If it already belongs to a different
    -- auth user, do nothing rather than hijack the account.
    WHERE public.user_profiles.auth_user_id IS NULL
       OR public.user_profiles.auth_user_id = EXCLUDED.auth_user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- Keep the profile email aligned when a user changes it in Supabase Auth.
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.user_profiles
       SET email = LOWER(NEW.email), updated_at = NOW()
     WHERE auth_user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;

CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_email_change();


-- ---------------------------------------------------------------------------
-- 2. Private helper functions
--
-- These live in `vyom_private`, which is NOT in Supabase's exposed schema list,
-- so PostgREST will not publish them as callable endpoints.
--
-- They are SECURITY DEFINER for a specific reason: the organization_members
-- policies need to read organization_members. A normal function would re-enter
-- that table's own policy and recurse infinitely. Running as the owner reads
-- the table without policy evaluation, which breaks the cycle.
--
-- Each is STABLE so PostgreSQL evaluates it once per statement instead of once
-- per row — the single most important RLS performance decision here.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS vyom_private;

REVOKE ALL ON SCHEMA vyom_private FROM PUBLIC;
GRANT USAGE ON SCHEMA vyom_private TO authenticated;

/**
 * Organization ids where the caller holds an ACTIVE membership in an ACTIVE
 * organization. The backbone of every tenant-isolation policy below.
 */
CREATE OR REPLACE FUNCTION vyom_private.current_organization_ids()
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
    AND o.status = 'ACTIVE';
$$;

/** Organizations the caller administers (OWNER or platform admin). */
CREATE OR REPLACE FUNCTION vyom_private.current_admin_organization_ids()
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
    AND m.role IN ('OWNER', 'SUPER_ADMIN');
$$;

/**
 * Organizations where the caller is staff — anyone except a CLIENT.
 * Clients get the portal, never practice-level data such as billing.
 */
CREATE OR REPLACE FUNCTION vyom_private.current_staff_organization_ids()
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
    AND m.role <> 'CLIENT';
$$;

/** The caller's own profile id. */
CREATE OR REPLACE FUNCTION vyom_private.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id
  FROM public.user_profiles p
  WHERE p.auth_user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION vyom_private.current_organization_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION vyom_private.current_admin_organization_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION vyom_private.current_staff_organization_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION vyom_private.current_profile_id() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vyom_private.current_organization_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION vyom_private.current_admin_organization_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION vyom_private.current_staff_organization_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION vyom_private.current_profile_id() TO authenticated;


-- ---------------------------------------------------------------------------
-- 3. Enable RLS
--
-- ENABLE, not FORCE. Forcing would also subject the table owner to policies,
-- and the application's Prisma connection is the owner — forcing it would break
-- every server-side query. The owner bypass is intentional and is exactly why
-- the Data Access Layer must authorize independently.
--
-- Anonymous callers are revoked outright: no policy grants `anon` anything, and
-- the explicit REVOKE means a future permissive policy still cannot expose
-- these tables to signed-out traffic.
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organizations        FROM anon;
REVOKE ALL ON public.user_profiles        FROM anon;
REVOKE ALL ON public.organization_members FROM anon;
REVOKE ALL ON public.subscriptions        FROM anon;

-- Table privileges, stated explicitly rather than inherited from Supabase's
-- default grants. RLS filters *rows*; these grant the *verbs*, and both must
-- allow an operation for it to succeed. Note what is absent: no INSERT or
-- DELETE anywhere, and no write verb at all on organization_members or
-- subscriptions. Even a future mistake in a policy cannot make those writable
-- from the browser.
REVOKE ALL ON public.organizations        FROM authenticated;
REVOKE ALL ON public.user_profiles        FROM authenticated;
REVOKE ALL ON public.organization_members FROM authenticated;
REVOKE ALL ON public.subscriptions        FROM authenticated;

GRANT SELECT, UPDATE ON public.organizations        TO authenticated;
GRANT SELECT, UPDATE ON public.user_profiles        TO authenticated;
GRANT SELECT         ON public.organization_members TO authenticated;
GRANT SELECT         ON public.subscriptions        TO authenticated;


-- ---------------------------------------------------------------------------
-- 4. organizations
--
-- Readable only by members. There is deliberately no policy letting an
-- authenticated user list all organizations — tenant names are themselves
-- competitive information, and enumeration is the first step of an attack.
--
-- INSERT and DELETE have no policy at all, so both are denied. Organizations
-- are created server-side during onboarding, and archived via `status` rather
-- than deleted.
-- ---------------------------------------------------------------------------

CREATE POLICY organizations_select_member ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT vyom_private.current_organization_ids()));

CREATE POLICY organizations_update_admin ON public.organizations
  FOR UPDATE TO authenticated
  USING (id IN (SELECT vyom_private.current_admin_organization_ids()))
  -- WITH CHECK repeats the condition so a row cannot be updated *out of* the
  -- caller's scope, e.g. by rewriting its id.
  WITH CHECK (id IN (SELECT vyom_private.current_admin_organization_ids()));


-- ---------------------------------------------------------------------------
-- 5. user_profiles
--
-- A user reads their own profile plus co-members of their organizations, which
-- is what a team list needs. Writes are restricted to their own row, and the
-- WITH CHECK pins auth_user_id so a user cannot re-point their profile at
-- somebody else's auth identity.
-- ---------------------------------------------------------------------------

CREATE POLICY user_profiles_select_self_or_comember ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    auth_user_id = (SELECT auth.uid())
    OR id IN (
      SELECT m.user_id
      FROM public.organization_members m
      WHERE m.organization_id IN (SELECT vyom_private.current_organization_ids())
    )
  );

CREATE POLICY user_profiles_update_self ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (auth_user_id = (SELECT auth.uid()))
  WITH CHECK (auth_user_id = (SELECT auth.uid()));

-- No INSERT policy: profiles are created only by the trigger above.
-- No DELETE policy: account deletion is a server-side, audited workflow.


-- ---------------------------------------------------------------------------
-- 6. organization_members
--
-- THE PRIVILEGE-ESCALATION BOUNDARY.
--
-- Read-only for authenticated callers. There is no INSERT, UPDATE, or DELETE
-- policy, so the Supabase client cannot write memberships at all. That is
-- stronger than trying to write a policy clever enough to allow legitimate role
-- changes while forbidding self-promotion — a user simply cannot make himself
-- OWNER or SUPER_ADMIN, because he cannot write this table by any path.
--
-- Membership changes go through server code that has already passed
-- requireRole(), and role values are validated against
-- ASSIGNABLE_ORGANIZATION_ROLES so SUPER_ADMIN can never be granted by
-- organization-facing code.
-- ---------------------------------------------------------------------------

CREATE POLICY organization_members_select_member ON public.organization_members
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT vyom_private.current_organization_ids()));


-- ---------------------------------------------------------------------------
-- 7. subscriptions
--
-- Visible to staff of the owning organization; CLIENT-role members are excluded
-- because billing is not their business. No write policy exists: subscription
-- state is set by billing webhooks server-side, never by a browser.
-- ---------------------------------------------------------------------------

CREATE POLICY subscriptions_select_staff ON public.subscriptions
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT vyom_private.current_staff_organization_ids()));


-- ---------------------------------------------------------------------------
-- 8. Indexes supporting the policies
--
-- Every policy above filters organization_members by (auth user → profile) and
-- by status. The existing indexes cover organization_id and user_id; this adds
-- the status dimension so the helper functions stay index-only as the table
-- grows.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS organization_members_user_id_status_idx
  ON public.organization_members (user_id, status);

CREATE INDEX IF NOT EXISTS organization_members_organization_id_status_idx
  ON public.organization_members (organization_id, status);
