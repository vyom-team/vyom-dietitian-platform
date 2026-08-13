import { Client } from "pg";

/**
 * Test harness for exercising Row Level Security as a real Supabase request
 * would.
 *
 * Supabase resolves the caller from the request JWT via `auth.uid()`, which
 * reads the `request.jwt.claims` setting. Simulating a signed-in user is
 * therefore a matter of assuming the `authenticated` role and setting that
 * claim — no Supabase session or network call required. Policies then evaluate
 * exactly as they do in production.
 *
 * Point RLS_TEST_DATABASE_URL at a disposable database with both migrations
 * applied. It must never be a real environment: these tests write and delete.
 */

export const rlsDatabaseUrl =
  process.env.RLS_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

export function hasRlsDatabase(): boolean {
  return Boolean(rlsDatabaseUrl);
}

/**
 * Whether the configured test database is actually reachable.
 *
 * "Configured" and "running" are different failures with different fixes, and a
 * raw `ECONNREFUSED` across a dozen tests says neither. This lets the suites
 * report the useful one: the variable is set, the container is not up.
 */
export async function isRlsDatabaseReachable(): Promise<boolean> {
  if (!rlsDatabaseUrl) return false;

  const client = new Client({
    connectionString: rlsDatabaseUrl,
    connectionTimeoutMillis: 3000,
  });

  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Message shown when the database is configured but unreachable. */
export const UNREACHABLE_MESSAGE =
  "RLS_TEST_DATABASE_URL is set but the database is not reachable. " +
  "Start it with:\n" +
  "  docker run -d --name vyom-test-pg -e POSTGRES_PASSWORD=postgres \\\n" +
  "    -e POSTGRES_DB=vyom_test -p 55432:5432 postgres:17-alpine\n" +
  "  npm run test:setup";

/** Connects as the table owner, which bypasses RLS. Used for fixture setup. */
export async function connectAsOwner(): Promise<Client> {
  if (!rlsDatabaseUrl) throw new Error("RLS_TEST_DATABASE_URL is not set");
  const client = new Client({ connectionString: rlsDatabaseUrl });
  await client.connect();
  return client;
}

export type QueryResult<T> = { rows: T[]; error?: string };

/**
 * One shared connection for impersonated queries.
 *
 * Opening a connection per query exhausts the pool quickly. Sharing is safe
 * because every query runs inside its own transaction and uses `SET LOCAL`, so
 * `ROLLBACK` restores the role and claims before the next caller sees it, and
 * tests within a file run sequentially.
 */
let impersonationClient: Client | undefined;

async function getImpersonationClient(): Promise<Client> {
  if (!impersonationClient) {
    impersonationClient = await connectAsOwner();
  }
  return impersonationClient;
}

export async function closeImpersonationClient() {
  if (impersonationClient) {
    await impersonationClient.end().catch(() => {});
    impersonationClient = undefined;
  }
}

/**
 * Runs `sql` as the given Supabase auth user, subject to RLS.
 *
 * Everything happens inside a transaction with `SET LOCAL`, so the role and
 * claims never leak into another test's connection.
 *
 * @param authUserId the `auth.users.id` to impersonate, or null for an
 * anonymous (signed-out) caller.
 */
export async function queryAs<T = Record<string, unknown>>(
  authUserId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const client = await getImpersonationClient();

  try {
    await client.query("BEGIN");

    if (authUserId) {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: authUserId, role: "authenticated" }),
      ]);
    } else {
      await client.query("SET LOCAL ROLE anon");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role: "anon" }),
      ]);
    }

    const result = await client.query(sql, params);
    await client.query("ROLLBACK");
    return { rows: result.rows as T[] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return { rows: [], error: (error as Error).message };
  }
}

export type Fixture = {
  orgAId: string;
  orgBId: string;
  userAAuthId: string;
  userBAuthId: string;
  clientUserAuthId: string;
  userAProfileId: string;
  userBProfileId: string;
};

/**
 * Two isolated tenants plus a client-role member of tenant A.
 *
 *   Organization A ← User A (OWNER), Client User (CLIENT)
 *   Organization B ← User B (OWNER)
 *
 * Auth users are inserted directly into the stub `auth.users`, which also
 * exercises the profile-creation trigger.
 */
export async function createFixture(client: Client, run: string): Promise<Fixture> {
  const insertAuthUser = async (email: string, fullName: string) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO auth.users (email, raw_user_meta_data)
       VALUES ($1, jsonb_build_object('full_name', $2::text))
       RETURNING id`,
      [email, fullName],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`failed to create auth user ${email}`);
    return id;
  };

  const userAAuthId = await insertAuthUser(`${run}-a@vyom.test`, "User A");
  const userBAuthId = await insertAuthUser(`${run}-b@vyom.test`, "User B");
  const clientUserAuthId = await insertAuthUser(`${run}-c@vyom.test`, "Client User");

  const profileId = async (authId: string) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM public.user_profiles WHERE auth_user_id = $1`,
      [authId],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`profile trigger did not create a row for ${authId}`);
    return id;
  };

  const userAProfileId = await profileId(userAAuthId);
  const userBProfileId = await profileId(userBAuthId);
  const clientProfileId = await profileId(clientUserAuthId);

  const createOrg = async (name: string, slug: string) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO public.organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [name, slug],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`failed to create organization ${slug}`);
    return id;
  };

  const orgAId = await createOrg("Org A", `${run}-org-a`);
  const orgBId = await createOrg("Org B", `${run}-org-b`);

  const addMember = (orgId: string, userId: string, role: string) =>
    client.query(
      `INSERT INTO public.organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, $3::organization_role, 'ACTIVE')`,
      [orgId, userId, role],
    );

  await addMember(orgAId, userAProfileId, "OWNER");
  await addMember(orgBId, userBProfileId, "OWNER");
  await addMember(orgAId, clientProfileId, "CLIENT");

  for (const orgId of [orgAId, orgBId]) {
    await client.query(
      `INSERT INTO public.subscriptions (organization_id) VALUES ($1)`,
      [orgId],
    );
  }

  return {
    orgAId,
    orgBId,
    userAAuthId,
    userBAuthId,
    clientUserAuthId,
    userAProfileId,
    userBProfileId,
  };
}

/** Removes everything the fixture created, in dependency order. */
export async function destroyFixture(client: Client, run: string) {
  await client.query(
    `DELETE FROM public.organization_members
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE slug LIKE $1)`,
    [`${run}-%`],
  );
  await client.query(`DELETE FROM public.organizations WHERE slug LIKE $1`, [
    `${run}-%`,
  ]);
  await client.query(`DELETE FROM public.user_profiles WHERE email LIKE $1`, [
    `${run}-%`,
  ]);
  await client.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`${run}-%`]);
}
