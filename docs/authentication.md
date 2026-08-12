# Authentication

Supabase Auth over `@supabase/ssr`, with Next.js 16's App Router. The deprecated
`@supabase/auth-helpers-nextjs` is **not** used.

For the security rationale behind these choices, see [security.md](security.md).

---

## Setup

### 1. Environment

```bash
cp .env.example .env.local
```

Fill in, from Supabase → Project Settings → API:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Both are public by design. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted as an
alias for projects still issuing the legacy `anon` JWT.

The app runs without them — auth screens show a "not configured" state instead
of crashing.

### 2. Supabase dashboard

Two settings, both under **Authentication**:

- **Providers → Email** — enabled. Email/password only; no social providers.
- **URL Configuration → Redirect URLs** — add:
  ```
  http://localhost:3000/auth/callback
  ```
  Add the deployed origin's callback URL when you deploy. Do not put a
  production URL in local configuration.

Email confirmation is on by default. Supabase's built-in email sender is
rate-limited and intended for development; a real provider is wired up in a
later phase.

### 3. Database

```bash
npm run db:deploy
```

Applies the trigger and RLS policies. Registration will not work without it —
the profile row is created by a database trigger.

---

## Architecture

```
Browser
  ↓
Supabase Auth          passwords, sessions, refresh, email verification
  ↓  httpOnly session cookie
proxy.ts               refreshes the session, optimistic redirects
  ↓
Server Component / Action
  ↓
Data Access Layer      requireAuth / requireRole / requireOrganizationAccess
  ↓
user_profiles → organization_members → organizations
```

Supabase Auth owns credentials. Our database owns profile, membership, role, and
organization data. The two are joined by one column:

```
auth.users.id  →  user_profiles.auth_user_id
```

### Files

| File | Role |
|---|---|
| `src/lib/supabase/client.ts` | Browser client (`createBrowserClient`) |
| `src/lib/supabase/server.ts` | Server client, per request (`createServerClient`) |
| `src/lib/supabase/proxy-session.ts` | Session refresh + optimistic redirect |
| `src/proxy.ts` | Next 16 proxy entry point (was `middleware.ts`) |
| `src/lib/auth/dal.ts` | Data Access Layer — the authorization boundary |
| `src/lib/auth/actions.ts` | Server Actions: sign in/up/out, reset |
| `src/lib/auth/routes.ts` | Route policy + open-redirect guard |
| `src/lib/auth/roles.ts` | Role model and assignment guards |
| `src/lib/auth/validation.ts` | Zod schemas, shared client and server |
| `src/lib/auth/error-messages.ts` | Provider errors → safe copy |

> **Next.js 16 renamed Middleware to Proxy.** The file is `src/proxy.ts` and
> exports `proxy`. Tutorials referencing `middleware.ts` describe the same hook
> under its old name.

The server client is created **per request** because it closes over that
request's cookie store. A module-level singleton would leak one user's session
into another user's request.

---

## Flows

### Registration

```
/register → signUp action → Zod → supabase.auth.signUp
  → auth.users row created
  → trigger creates user_profiles row (same transaction)
  → confirmation email
  → /auth/callback → session → /dashboard
```

`full_name` travels in `options.data` and is read by the trigger. The browser
never writes to `user_profiles`.

The response is identical whether or not the address was already registered —
see the account-enumeration note in [security.md](security.md).

### Sign in

```
/login → signIn action → Zod → signInWithPassword
  → session cookie → safeRedirectPath(?next) → /dashboard
```

### Password reset

```
/forgot-password → resetPasswordForEmail
  → email → /auth/callback?type=recovery → recovery session
  → /reset-password → updateUser({ password }) → /dashboard
```

No custom tokens: Supabase issues and validates the link. `updatePassword`
re-checks `getUser()` first, so posting to the action without a recovery session
fails.

### Sign out

A form posting to a Server Action, not a client fetch — clearing an httpOnly
cookie requires the server.

---

## Route protection

`src/lib/auth/routes.ts` is the single source of truth, shared by proxy and the
DAL so they cannot disagree.

**Protected:** `/dashboard`, `/clients`, `/plans`, `/foods`, `/reports`,
`/team`, `/subscription`, `/settings`, `/support`, `/onboarding`

**Public:** `/`, `/features`, `/pricing`, `/contact`, and all auth screens.

Matching is prefix-plus-boundary, so `/settingsomething` is not protected by the
`/settings` rule.

`/reset-password` is intentionally excluded from the "bounce signed-in users
away" list: the user holds a recovery session when they arrive, and redirecting
would break the flow.

### Redirects

| From | To |
|---|---|
| Unauthenticated → protected route | `/login?next=<path>` |
| Authenticated → `/login`, `/register`, `/forgot-password` | `/dashboard` |
| Callback failure | `/auth/auth-error?reason=<enum>` |

`?next=` is validated by `safeRedirectPath()`. `?reason=` is a fixed enum we
control, never provider text.

---

## Error handling

Users see fixed copy; provider messages are never rendered. Mapping lives in
`error-messages.ts`.

| Situation | Message |
|---|---|
| Wrong password *or* unknown email | "Invalid email or password." |
| Unconfirmed email | "Please confirm your email address before signing in…" |
| Rate limited | "Too many attempts. Please wait a few minutes…" |
| Expired link | "That link has expired. Please request a new one." |
| Anything else | "Something went wrong. Please try again." |

Submit buttons disable while pending ("Signing in…", "Creating account…"), which
is what prevents duplicate submissions.

---

## Testing

`npm test` covers route policy, open-redirect rejection, role-assignment guards,
and the full RLS tenant-isolation matrix. See the testing section of
[security.md](security.md) for the database setup.

Not automated: real email delivery, and the click-through of a live confirmation
link. Both require an external mailbox and are verified manually.

---

## Deliberately absent

No social login, no magic links, no MFA, no organization onboarding (that is the
next phase — a newly registered user has no organization and sees the
"no practice linked" state), no team invitations, and no Super Admin surface.
