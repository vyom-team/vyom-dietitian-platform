import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import {
  closeImpersonationClient,
  connectAsOwner,
  createFixture,
  destroyFixture,
  hasRlsDatabase,
  queryAs,
  type Fixture,
} from "./helpers/rls-db";

/**
 * Row Level Security — tenant isolation.
 *
 * The single most important test file in the project. It proves the database
 * itself refuses cross-tenant access, independent of any application code.
 *
 * Requires RLS_TEST_DATABASE_URL pointing at a disposable database with both
 * migrations applied. Skipped (not silently passed) when unset — see the
 * assertion in the outer describe.
 */

const run = `rls${Date.now().toString(36)}`;
const enabled = hasRlsDatabase();

describe.skipIf(!enabled)("Row Level Security", () => {
  let owner: Client;
  let fx: Fixture;

  beforeAll(async () => {
    owner = await connectAsOwner();
    await destroyFixture(owner, run);
    fx = await createFixture(owner, run);
  }, 60_000);

  afterAll(async () => {
    await closeImpersonationClient();
    if (owner) {
      await destroyFixture(owner, run);
      await owner.end();
    }
  });

  // -------------------------------------------------------------------------
  // The isolation matrix required by the phase specification.
  // -------------------------------------------------------------------------
  describe("organization isolation", () => {
    it("User A can read Organization A", async () => {
      const { rows } = await queryAs(
        fx.userAAuthId,
        `SELECT id FROM public.organizations WHERE id = $1`,
        [fx.orgAId],
      );
      expect(rows).toHaveLength(1);
    });

    it("User A CANNOT read Organization B", async () => {
      const { rows } = await queryAs(
        fx.userAAuthId,
        `SELECT id FROM public.organizations WHERE id = $1`,
        [fx.orgBId],
      );
      expect(rows).toHaveLength(0);
    });

    it("User B can read Organization B", async () => {
      const { rows } = await queryAs(
        fx.userBAuthId,
        `SELECT id FROM public.organizations WHERE id = $1`,
        [fx.orgBId],
      );
      expect(rows).toHaveLength(1);
    });

    it("User B CANNOT read Organization A", async () => {
      const { rows } = await queryAs(
        fx.userBAuthId,
        `SELECT id FROM public.organizations WHERE id = $1`,
        [fx.orgAId],
      );
      expect(rows).toHaveLength(0);
    });

    it("an unauthenticated visitor can read nothing", async () => {
      const result = await queryAs(
        null,
        `SELECT id FROM public.organizations WHERE id = $1`,
        [fx.orgAId],
      );
      // Either the grant is missing (error) or the policy filters it (0 rows).
      expect(result.error ?? "").toMatch(/permission denied|^$/);
      expect(result.rows).toHaveLength(0);
    });

    it("a user cannot enumerate all organizations", async () => {
      const { rows } = await queryAs<{ id: string }>(
        fx.userAAuthId,
        `SELECT id FROM public.organizations`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(fx.orgAId);
    });
  });

  // -------------------------------------------------------------------------
  describe("membership isolation", () => {
    it("User A sees only Organization A memberships", async () => {
      const { rows } = await queryAs<{ organization_id: string }>(
        fx.userAAuthId,
        `SELECT organization_id FROM public.organization_members`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.organization_id === fx.orgAId)).toBe(true);
    });

    it("User B cannot read Organization A memberships", async () => {
      const { rows } = await queryAs(
        fx.userBAuthId,
        `SELECT id FROM public.organization_members WHERE organization_id = $1`,
        [fx.orgAId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Privilege escalation. These are the attacks the phase specification calls
  // out by name.
  // -------------------------------------------------------------------------
  describe("privilege escalation", () => {
    it("a user CANNOT promote themselves to OWNER", async () => {
      const { error } = await queryAs(
        fx.clientUserAuthId,
        `UPDATE public.organization_members
            SET role = 'OWNER'
          WHERE organization_id = $1`,
        [fx.orgAId],
      );
      expect(error).toBeDefined();
      expect(error).toMatch(/permission denied/i);
    });

    it("a user CANNOT grant themselves SUPER_ADMIN", async () => {
      const { error } = await queryAs(
        fx.userAAuthId,
        `UPDATE public.organization_members
            SET role = 'SUPER_ADMIN'
          WHERE organization_id = $1`,
        [fx.orgAId],
      );
      expect(error).toBeDefined();
      expect(error).toMatch(/permission denied/i);
    });

    it("a user CANNOT insert a membership into another organization", async () => {
      const { error } = await queryAs(
        fx.userAAuthId,
        `INSERT INTO public.organization_members (organization_id, user_id, role, status)
         VALUES ($1, $2, 'OWNER', 'ACTIVE')`,
        [fx.orgBId, fx.userAProfileId],
      );
      expect(error).toBeDefined();
      expect(error).toMatch(/permission denied/i);
    });

    it("a user CANNOT delete a membership", async () => {
      const { error } = await queryAs(
        fx.userAAuthId,
        `DELETE FROM public.organization_members WHERE organization_id = $1`,
        [fx.orgAId],
      );
      expect(error).toBeDefined();
      expect(error).toMatch(/permission denied/i);
    });
  });

  // -------------------------------------------------------------------------
  describe("profile protection", () => {
    it("User A can read their own profile", async () => {
      const { rows } = await queryAs(
        fx.userAAuthId,
        `SELECT id FROM public.user_profiles WHERE id = $1`,
        [fx.userAProfileId],
      );
      expect(rows).toHaveLength(1);
    });

    it("User A CANNOT read User B's profile", async () => {
      const { rows } = await queryAs(
        fx.userAAuthId,
        `SELECT id FROM public.user_profiles WHERE id = $1`,
        [fx.userBProfileId],
      );
      expect(rows).toHaveLength(0);
    });

    it("User A CANNOT update User B's profile", async () => {
      const { rows } = await queryAs(
        fx.userAAuthId,
        `UPDATE public.user_profiles SET full_name = 'hijacked'
          WHERE id = $1 RETURNING id`,
        [fx.userBProfileId],
      );
      // The policy filters the row out, so the update matches nothing.
      expect(rows).toHaveLength(0);

      const check = await owner.query<{ full_name: string }>(
        `SELECT full_name FROM public.user_profiles WHERE id = $1`,
        [fx.userBProfileId],
      );
      expect(check.rows[0]?.full_name).toBe("User B");
    });

    it("a user CANNOT re-point their profile at another auth identity", async () => {
      const { rows, error } = await queryAs(
        fx.userAAuthId,
        `UPDATE public.user_profiles SET auth_user_id = $1
          WHERE id = $2 RETURNING id`,
        [fx.userBAuthId, fx.userAProfileId],
      );
      // WITH CHECK rejects the new row: either an error or zero rows changed.
      expect(error ?? rows.length === 0).toBeTruthy();

      const check = await owner.query<{ auth_user_id: string }>(
        `SELECT auth_user_id FROM public.user_profiles WHERE id = $1`,
        [fx.userAProfileId],
      );
      expect(check.rows[0]?.auth_user_id).toBe(fx.userAAuthId);
    });

    it("a user can see co-members of their own organization", async () => {
      const { rows } = await queryAs(
        fx.userAAuthId,
        `SELECT id FROM public.user_profiles`,
      );
      // User A plus the CLIENT member of Organization A — never User B.
      expect(rows.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe("subscription protection", () => {
    it("staff can read their own organization's subscription", async () => {
      const { rows } = await queryAs(
        fx.userAAuthId,
        `SELECT id FROM public.subscriptions WHERE organization_id = $1`,
        [fx.orgAId],
      );
      expect(rows).toHaveLength(1);
    });

    it("staff CANNOT read another organization's subscription", async () => {
      const { rows } = await queryAs(
        fx.userAAuthId,
        `SELECT id FROM public.subscriptions WHERE organization_id = $1`,
        [fx.orgBId],
      );
      expect(rows).toHaveLength(0);
    });

    it("a CLIENT-role member cannot read the subscription", async () => {
      const { rows } = await queryAs(
        fx.clientUserAuthId,
        `SELECT id FROM public.subscriptions WHERE organization_id = $1`,
        [fx.orgAId],
      );
      expect(rows).toHaveLength(0);
    });

    it("nobody can modify subscription state from the client", async () => {
      const { error } = await queryAs(
        fx.userAAuthId,
        `UPDATE public.subscriptions SET plan = 'ENTERPRISE' WHERE organization_id = $1`,
        [fx.orgAId],
      );
      expect(error).toBeDefined();
      expect(error).toMatch(/permission denied/i);
    });
  });

  // -------------------------------------------------------------------------
  describe("membership status is respected", () => {
    it("a SUSPENDED membership grants no access", async () => {
      await owner.query(
        `UPDATE public.organization_members SET status = 'SUSPENDED'
          WHERE organization_id = $1 AND user_id = $2`,
        [fx.orgAId, fx.userAProfileId],
      );

      const { rows } = await queryAs(
        fx.userAAuthId,
        `SELECT id FROM public.organizations WHERE id = $1`,
        [fx.orgAId],
      );
      expect(rows).toHaveLength(0);

      await owner.query(
        `UPDATE public.organization_members SET status = 'ACTIVE'
          WHERE organization_id = $1 AND user_id = $2`,
        [fx.orgAId, fx.userAProfileId],
      );
    });

    it("an ARCHIVED organization grants no access", async () => {
      await owner.query(
        `UPDATE public.organizations SET status = 'ARCHIVED' WHERE id = $1`,
        [fx.orgAId],
      );

      const { rows } = await queryAs(
        fx.userAAuthId,
        `SELECT id FROM public.organizations WHERE id = $1`,
        [fx.orgAId],
      );
      expect(rows).toHaveLength(0);

      await owner.query(
        `UPDATE public.organizations SET status = 'ACTIVE' WHERE id = $1`,
        [fx.orgAId],
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("profile synchronisation trigger", () => {
    it("creates a profile when an auth user is created", async () => {
      const email = `${run}-trigger@vyom.test`;
      await owner.query(
        `INSERT INTO auth.users (email, raw_user_meta_data)
         VALUES ($1, jsonb_build_object('full_name', 'Trigger User'))`,
        [email],
      );

      const { rows } = await owner.query<{ full_name: string; auth_user_id: string }>(
        `SELECT full_name, auth_user_id FROM public.user_profiles WHERE email = $1`,
        [email],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.full_name).toBe("Trigger User");
      expect(rows[0]?.auth_user_id).toBeTruthy();
    });

    it("links an invited profile instead of duplicating it", async () => {
      const email = `${run}-invited@vyom.test`;
      // Simulates an invitation: the profile exists with no auth user yet.
      await owner.query(`INSERT INTO public.user_profiles (email) VALUES ($1)`, [
        email,
      ]);

      await owner.query(`INSERT INTO auth.users (email) VALUES ($1)`, [email]);

      const { rows } = await owner.query<{ auth_user_id: string | null }>(
        `SELECT auth_user_id FROM public.user_profiles WHERE email = $1`,
        [email],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.auth_user_id).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("RLS is actually enabled", () => {
    it("every tenant table has row security on", async () => {
      const { rows } = await owner.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname IN ('organizations','user_profiles','organization_members','subscriptions')`,
      );
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
      }
    });

    it("no policy is unconditionally permissive", async () => {
      const { rows } = await owner.query<{ policyname: string; qual: string | null }>(
        `SELECT policyname, qual FROM pg_policies WHERE schemaname = 'public'`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.qual, `${row.policyname} must have a USING clause`).toBeTruthy();
        expect(
          (row.qual ?? "").trim().toLowerCase(),
          `${row.policyname} must not be USING (true)`,
        ).not.toBe("true");
      }
    });

    it("helper functions are not in an API-exposed schema", async () => {
      const { rows } = await owner.query<{ nspname: string }>(
        `SELECT n.nspname
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname LIKE 'current_%organization_ids'
             OR p.proname = 'current_profile_id'`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.nspname).toBe("vyom_private");
      }
    });
  });
});

// Fails loudly rather than reporting a green suite that tested nothing.
describe("RLS test configuration", () => {
  it("has a database configured", () => {
    expect(
      enabled,
      "RLS_TEST_DATABASE_URL is not set — tenant isolation was NOT verified. " +
        "See docs/security.md for how to start a disposable test database.",
    ).toBe(true);
  });
});
