-- ===========================================================================
-- Phase 5 — team invitations
--
-- One new table plus its RLS policies. The threat model:
--
--   * a member of practice A reading practice B's invitations
--   * anyone reading a token hash and reconstructing an invitation link
--   * a non-owner creating, revoking, or accepting invitations from the browser
--   * an invitation being accepted twice
--
-- As with every other tenant table: RLS protects the browser → Supabase path,
-- and src/lib/auth/dal.ts protects the server path, because Prisma connects as
-- the table owner and bypasses these policies. See docs/security.md.
-- ===========================================================================

CREATE TYPE "invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "organization_invitations" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"  UUID NOT NULL,
    "email"            VARCHAR(255) NOT NULL,
    "role"             "organization_role" NOT NULL,
    -- SHA-256 hex digest of the raw token. The token itself is never stored:
    -- a leaked backup must not yield usable invitation links.
    "token_hash"       VARCHAR(64) NOT NULL,
    "status"           "invitation_status" NOT NULL DEFAULT 'PENDING',
    "expires_at"       TIMESTAMPTZ(6) NOT NULL,
    "invited_by_id"    UUID NOT NULL,
    "accepted_at"      TIMESTAMPTZ(6),
    "accepted_by_id"   UUID,
    "revoked_at"       TIMESTAMPTZ(6),
    "message"          VARCHAR(500),
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- A token identifies at most one invitation.
CREATE UNIQUE INDEX "organization_invitations_token_hash_key"
  ON "organization_invitations"("token_hash");

-- One invitation row per address per practice. Re-inviting updates this row
-- with a fresh token rather than accumulating duplicates — which is what stops
-- an unbounded pile of pending invitations for a single address.
CREATE UNIQUE INDEX "organization_invitations_organization_id_email_key"
  ON "organization_invitations"("organization_id", "email");

-- Drives the pending-invitations list on the team page.
CREATE INDEX "organization_invitations_organization_id_status_idx"
  ON "organization_invitations"("organization_id", "status");

-- Finds a person's invitations once they sign up under that address.
CREATE INDEX "organization_invitations_email_status_idx"
  ON "organization_invitations"("email", "status");

ALTER TABLE "organization_invitations"
  ADD CONSTRAINT "organization_invitations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict, not cascade: an invitation records something a person did, and it
-- should survive changes to their profile.
ALTER TABLE "organization_invitations"
  ADD CONSTRAINT "organization_invitations_invited_by_id_fkey"
  FOREIGN KEY ("invited_by_id") REFERENCES "user_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
  ADD CONSTRAINT "organization_invitations_accepted_by_id_fkey"
  FOREIGN KEY ("accepted_by_id") REFERENCES "user_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Read-only for the browser, and only for organization admins. There is no
-- INSERT, UPDATE, or DELETE policy and no write grant, so the Supabase client
-- cannot create, revoke, or accept an invitation by any path. Every write goes
-- through server code that has already passed requireRole(OWNER).
--
-- This mirrors the organization_members decision in the Phase 3 migration: a
-- table that grants privileges is safest when the browser simply cannot write
-- to it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organization_invitations FROM anon;
REVOKE ALL ON public.organization_invitations FROM authenticated;

-- SELECT only. Note the absence of INSERT/UPDATE/DELETE.
GRANT SELECT ON public.organization_invitations TO authenticated;

-- Restricted to admins rather than all members: an invitation list reveals who
-- a practice is hiring and their email addresses, which is not something a
-- receptionist or a client-role member needs.
CREATE POLICY organization_invitations_select_admin
  ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT vyom_private.current_admin_organization_ids()));
