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

> **Phase 1 — Application Architecture + Design System**

The repository contains the application shell, route architecture, design
system, and reusable UI components. There is **no database, no authentication,
and no product functionality**.

Every screen is layout only. Where a page shows figures, they are static
placeholders labelled as such — and no clinical value (weight, calories, macros,
micronutrients) appears anywhere, since those must always come from real records
and reference data.

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
| Linting | ESLint (`eslint-config-next`) |

Planned for later phases and **not yet installed**: Prisma, Supabase
(Postgres / Auth / Storage), Razorpay, Resend.

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

---

## Environment

```bash
cp .env.example .env.local
```

**No environment variables are required yet** — the app runs with none set.
[.env.example](.env.example) documents the variables future phases will need
(database, Supabase, email, payments), each commented out and annotated with the
phase that introduces it.

Rules:

- `.env.local` is git-ignored and must never be committed.
- `NEXT_PUBLIC_*` values are inlined into the browser bundle and are **public**.
  Never give a secret that prefix.
- All environment access goes through [`src/config/env.ts`](src/config/env.ts),
  which validates variables with Zod at startup rather than scattering
  `process.env` reads across the codebase.

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
  components/
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
