# Team management

How a practice owner adds and manages the people who work with them.

---

## Architecture

No `teams` table. The organization **is** the team boundary, and membership is
the existing `OrganizationMember` row:

```
Organization
  ├── OrganizationMember  role = OWNER
  ├── OrganizationMember  role = DIETITIAN
  ├── OrganizationMember  role = DIETITIAN
  └── OrganizationMember  role = RECEPTIONIST
```

A team member is an authenticated user with a membership — there is no separate
`staff_users` or `dietitian_users` identity. That matters because a person may
work with two practices, and duplicating identities per practice would make that
impossible without a rewrite.

```
auth.users → user_profiles → organization_members → organizations
```

### Roles

| Role | In the interface | Can manage the team |
|---|---|---|
| `OWNER` | Practice owner | **Yes** |
| `DIETITIAN` | Dietitian | No |
| `RECEPTIONIST` | Receptionist | No |
| `CLIENT` | Client | No — not staff |
| `SUPER_ADMIN` | (internal) | Platform role, never granted by a tenant |

Only `DIETITIAN` and `RECEPTIONIST` are invitable. `ASSISTANT` appears in the
product vocabulary but is not in the database enum, so it is not offered —
adding an unused role now would be speculation.

---

## Invitation flow

```
owner → /team → Invite member
   ↓  server: requireRole(OWNER)
create invitation  (random token, SHA-256 hash stored)
   ↓
email with link  /invite/<token>
   ↓
invitee opens the link
   ├── signed out      → sign in or register, carrying ?next back here
   ├── wrong account   → told which address the invitation is for
   └── correct account → Join
   ↓  one transaction
membership created (ACTIVE) + invitation marked ACCEPTED
   ↓
practice dashboard
```

### Token security

A valid token grants membership, so it is a credential:

| Property | How |
|---|---|
| Unguessable | 32 bytes from the OS CSPRNG, base64url. Never a UUID or database id |
| Not recoverable from the database | Only the SHA-256 digest is stored |
| Single use | Acceptance updates conditionally on `status = 'PENDING'`; a second claim matches zero rows and the transaction rolls back |
| Time limited | 7 days |
| Not leaked by the browser | In the URL **path**, not the query string, so it stays out of `Referer` headers |
| Not leaked by logs | The dev email transport logs the subject and recipient, never the body |

Unsalted SHA-256 is deliberate here and would be wrong for a password: the input
is 256 bits of uniform randomness, so there is no dictionary to attack and
nothing for a slow hash to defend.

**Expiry is derived, not stored as state.** A row can be past `expiresAt` while
still marked `PENDING`, so every check compares the timestamp rather than
trusting the status. A test pins this, because a check that trusted status alone
would happily accept an expired invitation.

### Email binding

The signed-in user's address must equal the invited address. Without it, anyone
who obtained the link — a forwarded email, a shared screen — could join the
practice. The accept page says plainly when you are signed in as someone else
rather than offering a button that will fail.

### Duplicate handling

One invitation row per `(organization, email)`, enforced by a unique index.
Re-inviting **updates** that row with a fresh token and expiry, which
invalidates the previous link and keeps pending invitations bounded. The same
address can hold invitations from different practices.

Someone already on the roster gets a clear message instead of an invitation.

---

## Member lifecycle

| Status | Meaning | Access |
|---|---|---|
| `INVITED` | Invitation sent, not accepted | None |
| `ACTIVE` | Working in the practice | Full, per role |
| `SUSPENDED` | Access paused | **None** |
| `REMOVED` | No longer part of the practice | None |

Nothing is hard-deleted, and **removing someone from a practice never deletes
their Vyom account** — they may belong to other practices, and their past work
is referenced by records that must stay intact.

Suspension takes effect at both layers automatically: the Data Access Layer only
returns `ACTIVE` memberships, and the RLS helper functions filter on the same
condition. There is no separate "revoke access" step that could be forgotten.

### Owner protection

A practice must never reach zero owners — nobody could then manage billing,
team, or settings, and it is unrecoverable from inside the product.

Enforced server-side, inside the transaction, for both paths:

- demoting an owner
- suspending or removing an owner

The check and the write share a transaction so a concurrent demotion of the
other owner cannot slip between them. A **suspended owner does not count**: they
cannot administer anything, so counting them would let the last effective owner
be removed.

Owners also cannot suspend or remove themselves, which would lock them out of
the practice they administer.

Full ownership *transfer* — handing the practice to someone else and stepping
down — is not built. The protection above makes the unsafe half impossible; the
deliberate flow can be added when it is needed.

---

## Security

### Authorization

Every action follows one shape:

```
requireAuth() → organization from the session → requireRole(OWNER) → validate → service
```

**The organization id never comes from the request.** It is read from the
caller's session-derived membership, which removes the entire class of
cross-tenant attacks these actions would otherwise face. There is no field to
tamper with.

### What the payload cannot carry

`organizationId`, `userId`, and `status` are absent from every schema, so Zod
strips them. `role` is an enum of exactly `DIETITIAN | RECEPTIONIST`, so
`OWNER`, `SUPER_ADMIN`, and `CLIENT` fail validation at the boundary rather than
being caught by a later check.

### Defence in depth at the query

Every service query is scoped by `organizationId` in its `WHERE` clause. Even a
valid-looking membership or invitation id from another practice matches nothing,
so a bug in the layer above still cannot produce a cross-tenant write.

### RLS

`organization_invitations` has RLS enabled, a `SELECT`-only grant, and **no
INSERT, UPDATE, or DELETE policy**. The Supabase client cannot create, revoke,
or accept an invitation by any path — mirroring the `organization_members`
decision from Phase 3.

Reads are restricted to organization **admins**, not all members: the invitation
list reveals who a practice is hiring and their email addresses, which a
receptionist does not need.

As always, Prisma bypasses RLS because it owns the tables — which is exactly why
the DAL checks above are mandatory rather than belt-and-braces. See
[security.md](security.md).

---

## Email

`src/services/email.ts` is a transport abstraction with a **development
transport that logs instead of sending**, because no provider is configured yet.

It deliberately does not fake success: `send()` returns `delivered: false` with
reason `no-transport`, and the invite dialog then shows the owner the invitation
link to share directly. Reporting "invitation sent" for a message that never
left the building would be a lie the owner only discovers when the invitee never
arrives.

Templates live in `email-templates.ts`, free of `server-only`, so the copy and
the HTML escaping are unit-tested directly. All interpolated values are escaped;
a test asserts that hostile input cannot form an element.

The invitation email contains the practice name, role, inviter, expiry, and
link — and no client or health information.

This is application email, separate from Supabase Auth's verification and
password-reset messages.

---

## Interface

| Surface | Notes |
|---|---|
| `/team` | Roster, visible to all members; management actions for owners only |
| Invite dialog | Email, role (radio), optional message |
| Pending invitations | Owners only; shows expiry and a revoke action |
| Member actions | Change role, suspend, reactivate, remove |
| `/invite/[token]` | Public accept page; handles signed out, wrong account, expired, revoked, already used |

Actions are hidden when they would obviously fail — the last owner, or yourself
— but that is only to avoid offering a dead end. The server re-checks
everything, so a crafted request gets the same answer.

One responsive layout rather than a desktop table plus a mobile card list: rows
stack below `sm`, so there is a single markup path and no horizontal scrolling
on a phone.

---

## Future audit events

Not built yet. When audit logging arrives, these are the privilege-affecting
events worth recording:

`team_member_invited`, `team_member_invitation_accepted`,
`team_member_role_changed`, `team_member_suspended`,
`team_member_reactivated`, `team_member_removed`.

---

## Files

| Path | Role |
|---|---|
| `src/app/(dashboard)/team/page.tsx` | Team page |
| `src/app/invite/[token]/page.tsx` | Accept page |
| `src/components/team/*` | Dialog, roster, invitations, actions |
| `src/lib/team/actions.ts` | Server Actions — the authorization boundary |
| `src/services/team.ts` | Domain rules and transactions |
| `src/lib/invitation-token.ts` | Token generation, hashing, expiry |
| `src/validations/team.ts` | Schemas and the role allowlist |
| `src/services/email.ts` | Transport |
| `src/services/email-templates.ts` | Message content |
