# Multi-tenancy

Vyom is multi-tenant: many independent practices share one database and one
deployment. Organization A must never reach Organization B's data. For a
healthcare product, a cross-tenant leak is the worst failure the system can
have.

---

## The tenant is the Organization

```
Vyom
 └─ Organization          ← the tenant
     ├─ OrganizationMember  (User × Organization × Role)
     ├─ Subscription
     └─ everything a practice owns (later phases)
```

Never a `Dietitian` or a `User`. A solo practitioner and a twelve-person clinic
are both an `Organization` with different membership counts, so supporting
clinics later needs no re-architecture.

### Membership is its own table

A user's organization is **not** a column on `UserProfile`. It is a row in
`OrganizationMember` carrying the role:

```
UserProfile ──< OrganizationMember >── Organization
                      │
                    role, status
```

This costs one join and buys the ability for a consulting dietitian to work with
two clinics without a schema change. Putting `organization_id` on `UserProfile`
to "simplify queries" would foreclose that.

---

## The rule for every future table

Any table a practice owns gets:

1. An `organizationId` column with a foreign key to `organizations`
2. An index on `organizationId` (usually composite with the common filter)
3. An RLS policy scoping it to `vyom_private.current_organization_ids()`
4. Server code that only ever passes a verified `organizationId`

That applies to clients, intake records, plans, meals, logs, flags, reports, and
everything else in later phases. A table without `organizationId` is either
global reference data (the IFCT food database) or a mistake.

### Reference data is not tenant data

The food database and nutrition reference tables are shared and read-only for
practitioners. They carry no `organizationId` because they belong to no
practice. That is a deliberate exception, not an oversight.

---

## Two enforcement layers

Isolation is enforced twice, because the two access paths are different.

```
Browser → Supabase client → PostgREST → Postgres     enforced by RLS
Server  → Prisma          →            Postgres     enforced by the DAL
```

**Prisma bypasses RLS** — it connects as the table owner, and Postgres exempts
owners from policies. So RLS alone does not protect server code, and the DAL
alone does not protect the browser path. Both are required.

See [security.md](security.md) for the full explanation.

### Layer 1 — Row Level Security

Every policy resolves the caller's organizations through one function:

```sql
auth.uid()
  → user_profiles.auth_user_id
  → organization_members (status = 'ACTIVE')
  → organizations (status = 'ACTIVE')
  → organization_id
```

A row is visible only when its `organization_id` is in that set. No policy
grants an authenticated user the ability to list all organizations.

### Layer 2 — the Data Access Layer

```ts
const membership = await requireOrganizationAccess(untrustedId);
// membership.organizationId is now verified — safe to query with
```

`requireOrganizationAccess` is the IDOR guard. Any organization id arriving from
a request body, query string, form field, or route parameter passes through it
before it reaches a query. It throws `ForbiddenError` when the user has no
active membership, with a message identical to the "does not exist" case so it
cannot be used to probe for valid ids.

---

## What revokes access

Access requires an `ACTIVE` membership in an `ACTIVE` organization. Any of these
removes it immediately, at both layers:

| Change | Effect |
|---|---|
| Membership → `SUSPENDED` / `REMOVED` | No access to that organization |
| Membership → `INVITED` (not yet accepted) | No access |
| Organization → `SUSPENDED` / `ARCHIVED` | No access for any member |

Archival rather than deletion is the deletion strategy: clinical records carry
retention obligations, so a tenant leaving the platform is taken out of service
by `status`, not by dropping rows.

---

## Verification

`tests/rls.test.ts` runs the isolation matrix against a real PostgreSQL:

| Actor | Target | Expected |
|---|---|---|
| User A | Organization A | allowed |
| User A | Organization B | denied |
| User B | Organization B | allowed |
| User B | Organization A | denied |
| Anonymous | anything | denied |

Plus enumeration, membership visibility, self-promotion attempts, cross-profile
edits, subscription access by role, and the suspended/archived cases above.

These are database-level tests: they impersonate a Supabase user with
`SET ROLE authenticated` and `request.jwt.claims`, exactly as a real request
does, and never go through application code. Isolation is proven at the layer
that must hold even if the application is wrong.
