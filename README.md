# Vyom

A multi-tenant SaaS platform for Indian dietitians and nutritionists.

Vyom helps practitioners create defensible, India-specific nutrition plans
faster, then continuously track their clients after the plan is delivered —
replacing a workflow currently spread across Excel, calculators, nutrition
tables, PDFs, WhatsApp, and manual follow-up.

**Core principle: reference, don't generate.** Nutrition values are never
invented. Every nutrient figure traces to an authoritative Indian reference
(IFCT 2017, ICMR-NIN 2020, Indian food exchange lists). See [CLAUDE.md](CLAUDE.md).

---

## Current phase

> **Phase 7 — Nutrition Assessment Foundation**

The repository contains the application shell, design system, database
foundation, authentication with role-based access control and Row Level
Security, practice onboarding, team management, and the client management
foundation — a practice can create, search, assign, archive, and restore the
people it looks after.

Clinical data lives on `NutritionAssessment`, never on `Client` — which is what
lets a receptionist manage a client record without being able to read their
medical history. Meal plans, the food database, progress tracking, the client
portal, and billing all belong to later phases.

> **Terminology.** The database says `Organization`; the interface says
> **practice**. One entity, two names — see
> [docs/organization-onboarding.md](docs/organization-onboarding.md). Do not
> rename the models.

No clinical value (weight, calories, macros, micronutrients) appears anywhere in
the product, since those must always come from real records and approved
reference data.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui (Radix primitives) |
| Icons | lucide-react |
| Forms | React Hook Form + Zod (`@hookform/resolvers`) |
| Server state | TanStack Query |
| Client state | Zustand |
| Database | PostgreSQL 17 on Supabase Cloud |
| ORM | Prisma 7 (`@prisma/adapter-pg`) |
| Auth | Supabase Auth via `@supabase/ssr` |
| Tests | Vitest |
| Linting | ESLint (`eslint-config-next`) |

Planned for later phases and **not yet installed**: Supabase Storage, Razorpay,
Resend.

---

## Local development

Requires Node.js 20.9+ (developed on 24.x).

```bash
npm install
npm run dev
```

The app runs at http://localhost:3000.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint with autofix |
| `npm run typecheck` | TypeScript, no emit |
| `npm run check:contrast` | WCAG contrast check on the design tokens |
| `npm run check` | Typecheck + lint + contrast (run before committing) |

### Database scripts

| Command | Purpose |
|---|---|
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:migrate` | Create + apply a migration (development only) |
| `npm run db:deploy` | Apply existing migrations (production/CI) |
| `npm run db:status` | Migration state and drift |
| `npm run db:studio` | Browse data in Prisma Studio |
| `npm run db:seed` | Development fixtures (idempotent) |
| `npm run db:verify` | Assert constraints, keys, and indexes are enforced |

### Test scripts

| Command | Purpose |
|---|---|
| `npm test` | Full suite, including RLS tenant isolation |
| `npm run test:watch` | Watch mode |
| `npm run test:setup` | Prepare the disposable RLS test database |

---

## Environment

```bash
cp .env.example .env.local
```

The UI runs with **no environment variables set** — auth screens show a
"not configured" state rather than crashing.

| Variable | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | Any database access | Supabase pooler, port 6543. **Secret.** |
| `DIRECT_URL` | Migrations | Supabase direct, port 5432. **Secret.** Falls back to `DATABASE_URL`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Sign-in | Public by design |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sign-in | Public by design, RLS-constrained |
| `RLS_TEST_DATABASE_URL` | `npm test` | Disposable database only — the tests write and delete |

[.env.example](.env.example) documents these plus the variables later phases
need, each annotated with the phase that introduces it.

Rules:

- `.env` and `.env.local` are git-ignored and must never be committed.
- `NEXT_PUBLIC_*` values are inlined into the browser bundle and are **public**.
  Never give a secret that prefix.
- Environment access is split so secrets cannot leak into the client bundle:
  [`env.ts`](src/config/env.ts) holds browser-safe values, while
  [`env.server.ts`](src/config/env.server.ts) is guarded by `server-only` and
  holds the database URLs. Importing the latter from a client component is a
  build error.

## Database

PostgreSQL 17 on Supabase, accessed through Prisma 7. **Organization is the
tenant** — every future practice-owned table carries an `organization_id`.

```bash
cp .env.example .env.local    # fill in DATABASE_URL and DIRECT_URL
npm install                   # postinstall generates the Prisma client
npm run db:migrate            # apply migrations
npm run db:verify             # assert the foundation works
```

Visit `/system` for a connection status page.

Current models: `Organization`, `UserProfile`, `OrganizationMember`,
`OrganizationInvitation`, `Subscription`, `Client`, `ClientAssignment`,
`NutritionAssessment`. No plan or food tables yet — each arrives with the phase
that owns it.

[docs/database.md](docs/database.md) covers conventions, indexes, the deletion
strategy, and the migration workflow.

---

## Authentication

Supabase Auth via `@supabase/ssr`. Email and password only.

```bash
# 1. Add the Supabase keys to .env.local (Project Settings → API)
#    NEXT_PUBLIC_SUPABASE_URL
#    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

# 2. In Supabase → Authentication:
#    Providers → Email          : enabled
#    URL Configuration → Redirect URLs
#      http://localhost:3000/auth/callback

# 3. Apply the trigger and RLS policies
npm run db:deploy

npm run dev
```

Register at `/register`. A new account has no practice yet, so it lands on
`/onboarding`: practice details, your professional profile, review, then create.
The server makes you the **owner** — the role is never something you pick.

> **For development, turn off email confirmation.** Supabase's built-in sender
> allows only **2 emails per hour** and delivers **only to your project's team
> members**, which makes sign-up painful to iterate on. Go to
> **Authentication → Sign In / Providers → Email** and uncheck **"Confirm
> email"**; registration then completes instantly and signs you straight in.
> Re-enable it before production — the real fix there is custom SMTP.

### Two things worth knowing

**Next.js 16 renamed Middleware to Proxy.** The session hook is
[`src/proxy.ts`](src/proxy.ts). It refreshes the session and performs optimistic
redirects; it is *not* the authorization boundary.

**Prisma bypasses Row Level Security.** It connects as the table owner, so
policies do not constrain server queries. RLS protects the browser → Supabase
path; the Data Access Layer ([`src/lib/auth/dal.ts`](src/lib/auth/dal.ts))
protects the server path. Never query a tenant-owned table with an
`organizationId` that has not come back from `requireOrganizationAccess()`.

Full detail: [docs/authentication.md](docs/authentication.md),
[docs/security.md](docs/security.md),
[docs/multi-tenancy.md](docs/multi-tenancy.md),
[docs/organization-onboarding.md](docs/organization-onboarding.md),
[docs/team-management.md](docs/team-management.md),
[docs/client-management.md](docs/client-management.md),
[docs/nutrition-assessment.md](docs/nutrition-assessment.md).

## Team

An owner invites staff from `/team`. Invitations carry a cryptographically
random token whose **SHA-256 hash** is what the database stores, expire after
7 days, and are single-use. Only `DIETITIAN` and `RECEPTIONIST` can be invited —
`OWNER` and `SUPER_ADMIN` fail validation, so no request shape can ask for them.

> **Email delivery is not configured yet.** The invitation is created and the
> owner is shown the link to share directly, rather than being told an email was
> sent that never left the building. Wiring a provider means adding one
> transport in [`src/services/email.ts`](src/services/email.ts).

### Testing tenant isolation

```bash
docker run -d --name vyom-test-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=vyom_test -p 55432:5432 postgres:17-alpine

# .env.local
RLS_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:55432/vyom_test"

npm run test:setup
npm test
```

The suite fails rather than skipping when that variable is unset, so a green run
never means isolation went unchecked.

---

## Project structure

```
src/
  app/
    (marketing)/        Public site — /, /features, /pricing, /contact
    (auth)/             Sign-in flows — /login, /register, /forgot-password, …
    (dashboard)/        Practitioner app — /dashboard, /clients, /settings, …
    layout.tsx          Root layout, fonts, metadata
    providers.tsx       Theme, TanStack Query, Tooltip providers
    not-found.tsx
    auth/callback/      Supabase auth callback (email + recovery links)
    proxy.ts            Session refresh — see note above
  lib/
    auth/               Data Access Layer, actions, roles, route policy
    supabase/           Browser and server Supabase clients
  components/
    auth/               Sign-in forms and denial states
    ui/                 shadcn/ui primitives (generated; edit deliberately)
    layout/             Shell pieces — sidebar, topbar, marketing header/footer
    shared/             Reusable building blocks (see below)
    templates/          Page-shape templates
    theme/              Theme provider and toggle
  config/               Static config, validated env, navigation
  lib/                  Framework-agnostic helpers (cn)
scripts/                Repo tooling (contrast check)
```

Route groups keep the three audiences separate: each has its own layout, and the
parentheses mean the group name never appears in a URL.

Directories created as the phases that need them arrive:

```
  features/             Feature modules (auth, clients, nutrition, plans, …)
  services/             Business logic and data access
  validations/          Zod schemas shared between client and server
  types/                Shared TypeScript types
```

These are deliberately **not** created empty. Path aliases for them already
exist in [tsconfig.json](tsconfig.json), so the first file added to each needs no
configuration change.

### Shared components

| Component | Purpose |
|---|---|
| `PageHeader` | Title, description, breadcrumb, actions. Owns the page `h1`. |
| `Section` | Titled block within a page. Owns `h2`. |
| `Breadcrumbs` | Trail with correct `aria-current` on the last item. |
| `StatCard` | Metric tile with optional trend. `emphasis="primary"` once per page. |
| `StatusBadge` | Status pill — always pairs colour with an icon. |
| `DataTable` | Table shell with responsive column hiding. |
| `EmptyState` | Empty result with a clear next action. |
| `ErrorState` | Calm failure message with retry. Never shows technical detail. |
| `Container` | Page gutters and max width. |
| `PhasePlaceholder` | Honest "not built yet" page for future-phase routes. |

### Page templates

`StandardPage`, `ListPage`, `DetailPage`, and `SettingsPage` in
[page-templates.tsx](src/components/templates/page-templates.tsx) encode the four
page shapes, so future screens compose a layout instead of reinventing one.

### Layering

Business logic does not live in React components or route handlers:

```
UI → API / Server Action → Zod validation → Service → Repository → PostgreSQL
```

This matters most for the nutrition engine, which must stay deterministic and
independently testable. Nothing below the UI layer exists yet.

---

## Design system

Tokens live in [`src/app/globals.css`](src/app/globals.css) as CSS custom
properties consumed by Tailwind v4's `@theme`.

- **Brand** — a deep, calm teal (oklch hue ~187). Neutrals carry a trace of the
  same hue so greys sit with the brand rather than against it.
- **Status** — `success`, `warning`, `info`, `destructive`, each with a
  `-subtle` background pair. Status is **never** communicated by colour alone;
  `StatusBadge` always renders an icon too.
- **Typography** — a fixed scale exposed as `.type-*` classes (`type-display`,
  `type-h1`…`type-h4`, `type-body-lg/body/body-sm`, `type-label`,
  `type-caption`, `type-metric`). Use these instead of picking `text-*` sizes ad
  hoc; adding a step should be a deliberate decision.
- **Spacing** — Tailwind's default scale, applied consistently: `p-5` for cards,
  `gap-4` for grids, `space-y-8` between page sections.
- **Radius** — one `--radius` with every step derived from it. `rounded-xl` on
  surfaces, `rounded-md` on controls. No pill shapes outside status badges.
- **Elevation** — two steps only (`shadow-card`, `shadow-overlay`). Hierarchy
  comes from borders and surface contrast, not shadow.
- **Dark mode** — `next-themes` with light/dark/system, class strategy, no flash
  on load. Dark is a designed palette, not an inversion.

Colour choices are enforced, not asserted: `npm run check:contrast` converts
every token pair to sRGB and checks the WCAG ratio. All 22 pairs currently pass
AA. Re-run it after changing any colour.

The intended feel is premium, minimal, calm, and healthcare-appropriate. Avoid
heavy gradients, decorative animation, and glassmorphism.

Add components with:

```bash
npx shadcn@latest add <component>
```

---

## Development rule

**Phases are implemented sequentially, one at a time.**

Work does not begin on a phase until it is explicitly requested. Each session
provides the master context ([CLAUDE.md](CLAUDE.md)) plus a single phase prompt.
Features described in the master context are destination context, not a backlog
to work ahead on.

Phases 0 and 1 are complete: the project runs, lints, typechecks, builds, and has
an application shell and design system. Neither phase includes a database,
authentication, or any product feature.

## Accessibility

The baseline every new screen inherits:

- Semantic landmarks (`header`, `nav`, `main`, `footer`) with distinct labels
- One `h1` per page via `PageHeader`; `Section` owns `h2`
- Skip-to-content link in the marketing and dashboard layouts
- Visible focus rings on every interactive element (`focus-visible:ring`)
- Icon-only buttons carry `aria-label`; every input has an associated `label`
- Status is never colour-only
- `prefers-reduced-motion` respected for scroll behaviour
