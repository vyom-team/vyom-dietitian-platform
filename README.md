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

> **Phase 0 — Project Foundation**

This repository currently contains the development foundation only. There is no
database, no authentication, and no product functionality. The landing page is a
placeholder that exists to verify the shell and design system render correctly.

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
| `npm run check` | Typecheck + lint (run before committing) |

---

## Environment

```bash
cp .env.example .env.local
```

**Phase 0 requires no environment variables** — the app runs with none set.
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
  app/                  Next.js App Router — routes, layouts, providers
  components/
    ui/                 shadcn/ui primitives (generated; edit deliberately)
    layout/             Application shell — header, footer, frame
    shared/             Reusable presentational pieces (Container, PageHeader)
  config/               Static app config and validated environment access
  lib/                  Framework-agnostic helpers (cn)
```

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

### Layering

Business logic does not live in React components or route handlers:

```
UI → API / Server Action → Zod validation → Service → Repository → PostgreSQL
```

This matters most for the nutrition engine, which must stay deterministic and
independently testable.

---

## Design system

Tokens live in [`src/app/globals.css`](src/app/globals.css) as CSS custom
properties consumed by Tailwind v4's `@theme`.

- **Brand** — a deep, calm teal (oklch hue ~187). Neutrals carry a trace of the
  same hue so greys sit with the brand rather than against it.
- **Typography** — Geist, one family for headings and body via `--font-sans`.
- **Radius** — driven by a single `--radius`; all steps derive from it.
- **Elevation** — two steps only (`shadow-card`, `shadow-overlay`).
- **Dark mode** — tokens are defined under `.dark` and ready to use. No theme
  switcher is wired up yet; that arrives with the authenticated app.

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

Phase 0 is complete when the project runs, lints, typechecks, and builds. It
does not include database, authentication, or any product feature.
