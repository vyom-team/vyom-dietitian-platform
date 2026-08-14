# Client management

The first business module: creating, finding, assigning, and archiving the
people a practice looks after.

---

## A client is a record, not an identity

Creating a client does **not** create a Supabase Auth user. The `Client` model
holds no credentials and has no link to `auth.users`.

That separation matters. A practice adds a client at the front desk long before
— often instead of — that person ever signing in. When the client portal
arrives, it will link a `Client` to an auth user through its own model rather
than by adding auth columns here.

```
Organization (tenant)
  └── Client
        └── ClientAssignment ── OrganizationMember
```

Every client belongs to exactly one organization. There is no global client
pool, and no query in the module runs without an organization in its `WHERE`
clause.

### What this model deliberately does not hold

No weight, height, BMI, allergy, medication, condition, or calorie field.

Those belong to the assessment and nutrition models later phases introduce. Two
reasons, both practical: clinical data needs its own permission boundary, and a
`clients` table that accumulates "we'll need it later" columns becomes one
nobody can reason about. A test asserts none of these fields parse.

---

## Client number

Human-readable, spoken aloud in a clinic: **`VYM-000001`**.

Generated server-side from a **per-organization counter** — a `next_client_number`
column on the tenant row, incremented with `UPDATE … RETURNING` inside the
creation transaction.

`count(clients) + 1` was rejected for two reasons: it races under concurrent
creation, and it silently reuses a number after a client is archived. The
counter update takes a row lock, so simultaneous creations serialise. A unique
index on `(organization_id, client_number)` is the final arbiter. A test creates
ten clients concurrently and asserts ten distinct numbers.

Numbers are unique **per practice, not globally** — a shared sequence would let
one practice infer another's client volume from the gaps in its own.

**A client number is an identifier, not authorization.** Knowing `VYM-000124`
grants nothing; every lookup still goes through organization scoping.

---

## Roles

| | OWNER | DIETITIAN | RECEPTIONIST |
|---|---|---|---|
| See clients | All | **Assigned only** | All |
| Create | Yes | Yes | Yes |
| Edit | Yes | Yes | Yes |
| Archive / restore | **Yes** | No | No |
| Assign / reassign | **Yes** | No | No |

`CLIENT`-role members are rejected outright by `requireClientContext` — the
client portal is a later phase with much narrower access, and letting a
client-role member reach the staff module would expose every other client of the
practice. `SUPER_ADMIN` is a platform role with no client UI in this phase.

**Archive and assignment are owner-only deliberately.** Neither is destructive,
but both change who is responsible for someone's care, and no finalised business
rule delegates them. Widening a permission later is safe; discovering that a
receptionist archived a caseload is not.

### Visibility is a database rule, not a UI one

A dietitian sees the clients assigned to them. That restriction is a `WHERE`
clause:

```ts
assignments: { some: { organizationMemberId: viewer.membershipId, endedAt: null } }
```

The query never returns rows the viewer may not see, so there is no moment where
the data sits in process memory or crosses the wire and is then hidden. Fetching
everything and filtering in JavaScript would be a leak waiting for a rendering
bug.

The operational counts on the list page use the same scope, so a dietitian's
tallies match what they can actually open.

---

## Assignment

A join table, not a `dietitianId` column on `Client`.

The column would work today and would have to be unpicked the moment a practice
wants two people on one client, or wants to know who handled someone last year.
The join table costs one row and forecloses nothing.

It references the **membership**, not the user: assignment is a role within one
practice, which makes a cross-organization assignment impossible to express.

Phase 6 keeps **one active assignment per client**, enforced by a partial unique
index (`WHERE ended_at IS NULL`). Reassignment ends the current row and opens a
new one, so history accumulates while the current owner stays unambiguous.
Multiple concurrent assignments are a product decision, not a schema change.

Clients may be **unassigned** — a receptionist taking details at the desk should
not have to guess who will take the case.

> **Maintenance note.** Prisma cannot express a partial index, so
> `client_assignments_one_active_per_client` is invisible to `schema.prisma`.
> `prisma migrate dev` may propose dropping it; review any generated SQL
> touching that table and keep it. It is the only thing preventing two
> simultaneous active dietitians on one client.

---

## Lifecycle

```
create → ACTIVE ⇄ ARCHIVED
```

**There is no delete.** Assessments, plans, and progress records will reference
clients, and clinical records carry retention obligations. Archiving sets
`status` and `archived_at`; restoring clears both.

Archiving **does not** touch assignment history — who was responsible for a
client is information a practice may need long after that client goes inactive.

---

## Security

### Authorization

```
requireClientContext()      session → organization + membership + role
        ↓
per-action role gate        owner-only for archive and assignment
        ↓
service                     every query scoped by organizationId
        ↓
RLS                         defence in depth for the browser path
```

`requireClientContext` returns the organization, membership, and role together,
so a caller cannot accidentally build a query with an organization id from
somewhere else. There is deliberately no variant that accepts an organization id
as an argument.

### What the payload cannot carry

`organizationId`, `clientNumber`, `status`, `archivedAt`, and `createdById` are
absent from every schema, so Zod strips them. A crafted request has nothing to
grip — the class of attack is removed by the shape of the contract rather than
by a check that could be forgotten.

### IDOR

Every service query carries `organizationId` in its `WHERE`, so a valid-looking
client id from another practice matches nothing. `getClient` also applies the
viewer's visibility filter, so a dietitian requesting an unassigned client gets
`null` — **the same answer as for a client that does not exist**.

The route then renders not-found. A different response for "exists but forbidden"
would let someone probe for valid ids across practices.

### Cross-organization assignment

Guarded three times, because no foreign key can express "the member and the
client must belong to the same organization":

1. The assignment picker only lists eligible staff of this practice.
2. The service re-verifies the membership belongs here and may hold clients.
3. A `BEFORE INSERT OR UPDATE` trigger raises an exception otherwise.

The trigger is `SECURITY DEFINER` with an empty `search_path`, and is what makes
the invalid state unrepresentable regardless of which code path attempts it.

### Search

Prisma's parameterised `contains`, never string-built SQL. A search term is an
opaque value; a test feeds `'; DROP TABLE clients; --` through search and
asserts it matches nothing and the table survives.

Search, filters, and pagination all run inside the same organization- and
role-scoped query, so no page or filter combination can reach another practice.

### RLS

Both tables have RLS enabled, a `SELECT`-only grant, and **no INSERT, UPDATE, or
DELETE policy**. The Supabase client cannot create or modify a client by any
path. `anon` has nothing.

Reads are scoped to staff membership; `CLIENT`-role members are excluded.

As always, Prisma bypasses RLS because it owns the tables — which is exactly why
the Data Access Layer checks are mandatory rather than belt-and-braces. See
[security.md](security.md).

### Privacy

Client rows contain personal data. Nothing in the service logs a client object,
name, email, phone, or address — error logs carry ids and nothing more. All test
and development data is synthetic.

---

## Interface

| Route | Purpose |
|---|---|
| `/clients` | List: search, status and dietitian filters, pagination |
| `/clients/new` | Add a client |
| `/clients/[clientId]` | Profile, archive/restore, assignment |
| `/clients/[clientId]/edit` | Edit details |

Search and filter state lives in the **URL**, so a filtered list is linkable and
survives a refresh — and the filtering happens server-side.

The profile page has no Assessment / Meal Plan / Progress tabs. Those modules do
not exist, and empty tabs promising them would misrepresent the product.

Pagination is 20 per page. The list rows stack below `sm` rather than scrolling
sideways, and each row is a single link — one keyboard stop, one tap target.

---

## Not implemented in Phase 6

Nutrition assessment · medical history · weight, height, BMI · allergies ·
medications · meal plans · food database · nutrition calculations · progress
tracking · consultation notes · appointments · client portal · client
authentication · client invitations · billing · **subscription limits** ·
analytics · email on client creation.

Client email is stored as contact information only. Nothing is sent when a
client is created.

### Subscription limits

Not implemented — pricing and limits are not finalised, and inventing a number
now would bake in a decision nobody has made. `createClient` is structured so a
`checkSubscriptionLimit(organizationId)` call slots in ahead of the transaction
without disturbing anything else.

### Future audit events

`client_created`, `client_updated`, `client_archived`, `client_restored`,
`client_assigned`, `client_reassigned`.

---

## Files

| Path | Role |
|---|---|
| `src/app/(dashboard)/clients/**` | List, new, profile, edit |
| `src/components/clients/**` | Form, list, filters, pagination, actions |
| `src/lib/clients/actions.ts` | Server Actions — authorization boundary |
| `src/lib/clients/rules.ts` | Pure rules: visibility, number format |
| `src/services/clients.ts` | Queries and transactions |
| `src/validations/client.ts` | Schemas |
