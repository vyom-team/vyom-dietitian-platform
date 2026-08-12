# Security

How Vyom protects account data and enforces tenant boundaries. Read this before
touching authentication, authorization, or any query against a tenant-owned
table.

---

## The one thing to understand first

**Prisma bypasses Row Level Security.**

The application connects to PostgreSQL as the database user that owns the
tables. Postgres exempts a table's owner from its RLS policies, so a Prisma
query sees *every row in the database* regardless of who is signed in.

That is not a bug and it is not something to fix by forcing RLS — the owner
needs unrestricted access to run migrations. It does mean the two layers protect
different paths:

| Path | Protected by |
|---|---|
| Browser → Supabase client → PostgREST | **Row Level Security** |
| Server Component / Action → Prisma → Postgres | **The Data Access Layer** |

Neither is redundant. RLS is what stops a crafted request from the browser. The
DAL is what stops a careless server query. A mistake in either one is a
cross-tenant data leak.

**The rule that follows:** never query a tenant-owned table with an
`organizationId` that has not come back from `requireOrganizationAccess()`.

```ts
// WRONG — organizationId came from the request and was never verified
const clients = await prisma.client.findMany({
  where: { organizationId: body.organizationId },
});

// RIGHT — membership is verified first; the returned id is trustworthy
const membership = await requireOrganizationAccess(body.organizationId);
const clients = await prisma.client.findMany({
  where: { organizationId: membership.organizationId },
});
```

---

## Layers

```
Browser
  ↓  session cookie (httpOnly, set by Supabase SSR)
proxy.ts                    optimistic redirect + token refresh — NOT security
  ↓
Server Component / Action
  ↓  requireAuth() → getUser() verifies the token with Supabase
Data Access Layer           role and membership checks
  ↓  organizationId is now verified
Prisma                      bypasses RLS — relies on the layer above
  ↓
PostgreSQL + RLS            protects the Supabase-client path
```

### Why proxy.ts is not the security boundary

Next.js runs proxy on every request including prefetches, so it must not query
the database. It reads the session cookie and redirects — an optimistic check
that improves the experience. Next's own documentation is explicit that proxy
"should not be used as a full session management or authorization solution."

Every protected surface therefore re-checks in the layout, page, or action. If
proxy were deleted tomorrow, nothing would become readable.

### Why `getUser()` and never `getSession()`

`getSession()` decodes the session cookie without verifying it. A forged cookie
passes. `getUser()` revalidates the token against Supabase's auth server, so it
is the only one used for an authorization decision. This appears in
`dal.ts` and `proxy-session.ts`.

---

## Authentication

Supabase Auth owns passwords, sessions, refresh tokens, email verification, and
password reset. **This database never stores a password, hash, OTP, or reset
token** — `user_profiles` deliberately has no credential column.

Sessions are httpOnly cookies managed by `@supabase/ssr`. No token is written to
`localStorage`, Zustand, or React state, so a cross-site scripting bug cannot
read the session out of the page.

### Profile creation

A database trigger on `auth.users`, not client-side code:

```
auth.users INSERT
  → handle_new_auth_user()   SECURITY DEFINER, search_path = ''
  → public.user_profiles row
```

Two reasons. First, the browser must never be able to create a profile row for
an arbitrary auth user. Second, the trigger runs in the same transaction as the
auth user, so there is no window where a session exists without a profile — the
registration race is eliminated rather than mitigated.

The trigger's `ON CONFLICT (email)` branch adopts a profile that was created by
invitation, and only when it is unclaimed (`auth_user_id IS NULL`) or already
belongs to the same auth user. It cannot hijack somebody else's account.

---

## Authorization

Roles only — no permission tables, no policy engine. Roles are enough for the
decisions the product makes today.

| Role | Scope |
|---|---|
| `SUPER_ADMIN` | **Platform** role. Vyom staff. Never granted through onboarding or team management. |
| `OWNER` | Organization administration: billing, team, practice settings |
| `DIETITIAN` | Clinical work: clients, plans, nutrition |
| `RECEPTIONIST` | Administrative work within a practice |
| `CLIENT` | Client portal only. Never practitioner functionality. |

`SUPER_ADMIN` is deliberately excluded from `ASSIGNABLE_ORGANIZATION_ROLES`, so
organization-facing code cannot offer or grant it. `isAssignableOrganizationRole`
is the guard; it rejects `SUPER_ADMIN` and `CLIENT` and is unit-tested.

### Helpers

All in `src/lib/auth/dal.ts`, all memoised per request with React `cache()`:

| Helper | Purpose |
|---|---|
| `getAuthUser()` | Verified Supabase user, or null |
| `getCurrentUser()` | User + profile + **active** memberships, or null |
| `requireAuth()` | Redirects to sign-in when absent |
| `requireOrganization()` | Throws `NoOrganizationError` when unaffiliated |
| `requireOrganizationAccess(id)` | **The IDOR guard.** Verifies membership, throws `ForbiddenError` |
| `requireRole(id, roles)` | Membership *and* role check |
| `getMembership(id)` | Non-throwing, for conditional UI |

Only `ACTIVE` memberships in `ACTIVE` organizations are returned. An `INVITED`,
`SUSPENDED`, or `REMOVED` membership confers nothing, and a suspended or
archived organization grants nothing regardless of membership.

### Denial semantics

| Situation | Response |
|---|---|
| No session | Redirect to `/login` |
| Signed in, not permitted | 403 state, **no redirect** — bouncing to sign-in would loop |
| Signed in, no organization | Onboarding state, not an error |

---

## Row Level Security

Enabled on all four tables. `ENABLE`, not `FORCE`: forcing would apply policies
to the table owner and break every Prisma query.

| Table | SELECT | Writes |
|---|---|---|
| `organizations` | Members only | UPDATE by OWNER/SUPER_ADMIN. No INSERT or DELETE policy. |
| `user_profiles` | Own profile + co-members | UPDATE own row only, `auth_user_id` pinned |
| `organization_members` | Members of that organization | **None at all** |
| `subscriptions` | Staff of that organization (not CLIENT) | **None at all** |

### The privilege-escalation boundary

`organization_members` has **no write policy and no write grant**. The Supabase
client cannot insert, update, or delete a membership by any path.

This is stronger than a policy clever enough to permit legitimate role changes
while forbidding self-promotion. A user cannot make themselves `OWNER` or
`SUPER_ADMIN` because they cannot write the table at all. Membership changes go
through server code that has already passed `requireRole()`.

Table privileges are granted explicitly rather than inherited from Supabase's
defaults. Note what is absent: no `INSERT` or `DELETE` anywhere, and no write
verb at all on `organization_members` or `subscriptions`. Even a future mistake
in a policy cannot make those writable from a browser.

`anon` is revoked from all four tables, so signed-out traffic reads nothing.

### Helper functions

`vyom_private.current_organization_ids()` and friends. Three deliberate choices:

- **Private schema.** `vyom_private` is not in Supabase's exposed schema list,
  so PostgREST will not publish these as callable endpoints.
- **`SECURITY DEFINER`.** The `organization_members` policy needs to read
  `organization_members`; a normal function would re-enter its own policy and
  recurse forever. Running as the owner breaks the cycle.
- **`SET search_path = ''`.** Every object is schema-qualified, so an attacker
  cannot shadow one with an object in a schema they control.

Execute is granted to `authenticated` only, revoked from `PUBLIC`.

### Performance

Functions are `STABLE`, so Postgres evaluates them once per statement rather
than once per row — the single most important RLS performance decision here.
`(SELECT auth.uid())` is used rather than a bare `auth.uid()` for the same
reason. Supporting indexes: `organization_members (user_id, status)` and
`(organization_id, status)`.

---

## Specific attacks and what stops them

| Attack | Defence |
|---|---|
| Read another tenant's rows via the browser | RLS policies scope every SELECT to `current_organization_ids()` |
| Read another tenant's rows via a server query | `requireOrganizationAccess()` before any Prisma call |
| IDOR — pass someone else's `organizationId` | Same. The id is verified, never trusted |
| Self-promotion to OWNER / SUPER_ADMIN | No write grant or policy on `organization_members`; `isAssignableOrganizationRole` rejects `SUPER_ADMIN` |
| Edit another user's profile | `user_profiles` UPDATE policy restricted to own row |
| Re-point a profile at another auth identity | `WITH CHECK (auth_user_id = auth.uid())` |
| Client alters subscription/billing | No write grant on `subscriptions`; CLIENT excluded from SELECT |
| Open redirect after sign-in | `safeRedirectPath()` allows same-site absolute paths only; unit-tested against `//host`, `https://`, backslash, and scheme tricks |
| Host-header redirect poisoning | Callback redirects built from `request.nextUrl.origin` |
| Account enumeration | Sign-in returns one message for all failures; registration and reset return identical copy regardless of whether the address exists |
| Session theft via XSS | Session is an httpOnly cookie; never in `localStorage` or JS-readable state |
| Forged session cookie | `getUser()` revalidates with Supabase rather than trusting the cookie |
| Reading secrets from the browser bundle | `server-only` on `env.server.ts`, `prisma.ts`, `dal.ts`, `supabase/server.ts` — a client import fails the build |
| Enumerating tenants | No "authenticated can read all organizations" policy exists |

---

## Secrets

| Variable | Exposure |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public by design |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public by design, RLS-constrained |
| `DATABASE_URL`, `DIRECT_URL` | **Secret.** Server only |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret.** Not used anywhere today |

The service-role key bypasses RLS entirely and is deliberately unused. Reaching
for it is how tenant isolation gets quietly undone. If a future phase needs it,
isolate that code and document why it must bypass RLS — it is never a shortcut
around authorization.

`.env.local` is git-ignored. `.env.example` contains names and placeholders
only.

---

## Testing

```bash
docker run -d --name vyom-test-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=vyom_test -p 55432:5432 postgres:17-alpine

# in .env.local
RLS_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:55432/vyom_test"

npm run test:setup   # applies the auth stub and migrations
npm test
```

The suite impersonates a Supabase user the same way Supabase does — assume the
`authenticated` role and set `request.jwt.claims` — so policies evaluate exactly
as in production. `prisma/shadow-init.sql` reproduces the parts of Supabase's
`auth` schema the policies depend on.

If `RLS_TEST_DATABASE_URL` is unset the suite **fails** rather than skipping
quietly, so a green run never means "tenant isolation was not checked".

> Prisma's bundled WASM Postgres (`prisma dev`) crashes on RLS-filtered
> `UPDATE ... RETURNING` under a non-owner role. Use a real PostgreSQL for these
> tests.

---

## Not yet built

Audit logging is **not** implemented. The events that will need it: sign-in,
sign-out, password reset, role change, membership change, organization access,
and subscription change. Client health data arrives in later phases and raises
the stakes — audit logging should land before it does.

Also absent by design: rate limiting beyond Supabase's own, multi-factor
authentication, session revocation UI, and the Super Admin surface.
