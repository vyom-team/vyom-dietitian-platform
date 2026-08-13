-- ===========================================================================
-- Phase 4 — practice onboarding fields
--
-- "Practice" is the user-facing word for an Organization. The database keeps
-- the tenant-neutral name; only the UI says practice.
--
-- Every column added here is either nullable or has a default, so the migration
-- is safe against existing rows and needs no backfill.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Organizations — practice details captured during onboarding
-- --------------------------------------------------------------------------

-- ISO 3166-1 alpha-2 rather than a display name: codes are stable across
-- locales, and the name is derived at render time.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT 'IN';

-- IANA identifier, never an abbreviation. "IST" is ambiguous (India vs Ireland
-- vs Israel) and carries no daylight-saving rules, which scheduling will need.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata';

-- Practice contact details. Distinct from the owner's login email, which stays
-- in Supabase Auth.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS phone VARCHAR(32);
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS website TEXT;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS address_line VARCHAR(200);
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS state VARCHAR(100);
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);

-- --------------------------------------------------------------------------
-- User profiles — professional details for the practice owner
-- --------------------------------------------------------------------------

-- Free text, not an enum: credentials differ by country and registering body,
-- and a fixed list would exclude legitimate ones.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS professional_title VARCHAR(120);
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS bio TEXT;

-- Widened from 20: E.164 with separators and an extension exceeds 20 chars.
ALTER TABLE public.user_profiles
  ALTER COLUMN phone TYPE VARCHAR(32);

-- --------------------------------------------------------------------------
-- Grants
--
-- The Phase 3 migration granted UPDATE on these tables to `authenticated`, and
-- that grant is column-independent, so the new columns are already covered by
-- the existing RLS policies. Nothing to change — this note exists so the
-- omission reads as deliberate rather than forgotten.
-- --------------------------------------------------------------------------
