-- Shadow-database bootstrap.
--
-- Prisma validates every migration against a throwaway "shadow" database. That
-- database is plain PostgreSQL and has none of Supabase's managed objects, so a
-- migration referencing `auth.users` or `auth.uid()` would fail there even
-- though it is perfectly valid against the real project.
--
-- This script recreates just enough of Supabase's auth surface for validation.
-- It runs ONLY against the shadow database and never against a real one, so it
-- cannot overwrite Supabase's own definitions.
--
-- It is also what makes a local Postgres behave like Supabase for the RLS
-- tests, which is the only way to exercise the policies without minting real
-- Supabase sessions.

CREATE SCHEMA IF NOT EXISTS auth;

-- Supabase's two request roles. RLS policies are written against these.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- Minimal stand-in for auth.users. Only the columns our trigger reads.
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              varchar(255),
  raw_user_meta_data jsonb,
  created_at         timestamptz DEFAULT now()
);

-- Supabase resolves the caller from the request JWT. This mirrors that exactly:
-- the real implementation also reads `request.jwt.claims`.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  )::text
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;

-- Supabase grants USAGE on `public` to the request roles as part of project
-- setup. Reproduce it so policies behave identically here; without it every
-- query fails with "permission denied for schema public" before RLS is ever
-- evaluated, which would make the deny-tests pass for entirely the wrong reason.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
