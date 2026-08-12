# Vyom — Master Context

> This file is the stable, always-loaded understanding of what Vyom is.
> It is **not** a task list. Nothing in this file is an instruction to build.

---

## How we work

Each development session gives Claude exactly two things:

```
Master Context (this file)  +  Current Phase Prompt
```

The full 20-phase roadmap is **deliberately not in this file.** Seeing the whole
roadmap causes exactly the failure we want to avoid — "there's a food parser in
the roadmap, let me build it now."

Therefore:

- Build **only** what the current phase prompt asks for.
- Do not start, scaffold, or "prepare for" a later capability described below.
- The feature descriptions in this file exist so you understand the destination,
  not so you build toward it early.
- If a request seems to fall outside the current phase, **ask** — do not assume.

**Current phase:** `PHASE 3 — Authentication + RBAC + Multi-tenancy + RLS`

Implemented so far: project foundation (0), application shell and design system
(1), Supabase/Prisma database foundation (2), and authentication with
role-based access control and Row Level Security (3).

Still absent by design: organization onboarding and every product feature.
No screen is connected to product data.

**Two architectural facts that matter before touching data access:**

1. Next.js 16 renamed Middleware to Proxy — the file is `src/proxy.ts`, and it
   is *not* the authorization boundary.
2. **Prisma bypasses Row Level Security** (it connects as the table owner). RLS
   protects the browser→Supabase path; `src/lib/auth/dal.ts` protects the server
   path. Never query a tenant-owned table with an `organizationId` that has not
   come back from `requireOrganizationAccess()`. See `docs/security.md`.

---

## 1. What Vyom is

A production-grade, multi-tenant SaaS platform for Indian dietitians and
nutritionists.

> Help Indian dietitians create defensible, India-specific nutrition plans
> faster, then continuously track their clients after the plan is delivered.

It replaces a workflow currently spread across Excel, calculators, nutrition
tables, PDFs, WhatsApp, and manual follow-up.

Product areas: practice management, client management, Indian nutrition
calculation engine, food database, meal plan generator, diet plan editor, client
portal, client progress tracking, practitioner analytics, subscription &
billing, super admin.

---

## 2. Prime directive — reference, don't generate

**Nutrition values are never invented.** The calculation system is deterministic
and traceable to authoritative Indian nutrition references:

- IFCT 2017
- ICMR-NIN 2020
- Indian food exchange lists

Every nutrient value must trace back to a database/reference row.

Hard prohibitions:

- No AI-generated nutrient values
- No fabricated foods
- No autonomous AI diet-plan generation
- No diagnosis
- No replacement of practitioner clinical judgment

Any future AI/LLM capability may assist with *interpretation* (e.g. parsing free
text) but must never become the source of truth for nutrition numbers.

### Open values — never guess these

The PRD is the source of truth for numeric rules and is not present in this
repo. The following are **unknown** and must be supplied before the phase that
needs them: Asian-Indian BMI cutoffs, activity factors, goal calorie
adjustments, protein g/kg (baseline and per condition), pregnancy/lactation
adjustments, fat % of calories, fiber targets, micronutrient RDAs, pricing, and
plan limits.

If a calculation needs one of these and it has not been provided, **stop and
ask.** Do not substitute a plausible number, not even as a placeholder or in an
example.

---

## 3. Users and roles

**Super Admin** — internal Vyom platform role. Manages organizations, users,
subscriptions, payments, platform configuration, food/reference datasets,
feature flags, support, platform analytics, suspension/reactivation, audit logs.
Never part of normal practitioner workflows.

**Organization** — the tenant. Every customer exists as an `Organization`
(e.g. "Healthy Life Clinic", "Priya Nutrition Practice"). It owns the
subscription, users, clients, plans, settings, and data.

**Organization Owner** — the practitioner who created the organization. Manages
clients, plans, practice settings, subscription, analytics; can invite team
members later.

**Dietitian / Staff** — future role (multiple dietitians, nutrition assistants,
receptionists). Do not implement team functionality early, but do not design in
a way that blocks it.

**Client** — created and invited by a practitioner. Cannot self-register a
normal client account. Cannot access other clients, edit the practitioner's
plan, reach the food database editor, or use practitioner functionality.

### Decision: Organization is the tenant, not Dietitian

**Why:** it supports both solo dietitians and multi-dietitian clinics without a
later re-architecture. Do not build core architecture around a `Dietitian` as
the tenant.

---

## 4. Hierarchy

```
Vyom Platform
  └─ Organizations
       └─ Users / Members
            └─ Clients
                 └─ Plans
                      └─ Meals
                           └─ Food Items
                                └─ Logs
```

The subscription belongs to `Organization`, never directly to a user.

---

## 5. Organization signup

Default onboarding is **self-service** — a dietitian never waits for a Super
Admin.

```
Website → Start Free Trial → Create Practice → practice info → owner account
→ email verification → organization created → owner created → free trial
→ onboarding wizard → dashboard
```

Super Admin only monitors and manages organizations after creation.
Enterprise customers may later use sales-assisted onboarding.

---

## 6. Core practitioner workflow

```
Login → Dashboard → Create Client → Client Intake → Food Frequency
→ Calculate Targets → Generate Weekly Plan → Review → Edit → Approve
→ Generate PDF → Invite Client → Client follows plan → Client logs meals
→ Client logs weight/symptoms → Practitioner monitors progress
→ Practitioner reviews flags → Practitioner revises plan → Next follow-up cycle
```

This practitioner-first flow is fundamental to the product.

---

## 7. What the platform does

Descriptions of the destination. **Not a build queue.**

### Client intake

Age, sex, height, weight, activity level, goal, physiological status, allergies,
preferences, lifestyle, notes.

Goals: loss, maintenance, gain.
Physiological statuses: PCOS, diabetes, pregnancy T1/T2/T3, lactation 0–6 months,
lactation 6–12 months.

Produces a live target preview: BMI, BMR, TDEE, target calories, macro targets,
intake gap.

### Nutrition calculation engine

Deterministic. Lives in a dedicated domain/service layer — **never inside React
components.**

```
UI → Validation → Nutrition Service → Calculation Rules → Reference Data → Result
```

Covers BMI (with Asian-Indian classification), BMR (Mifflin-St Jeor), TDEE
(BMR × activity factor), physiological adjustments, goal adjustments, protein,
fat, fiber, carbohydrate (remaining calories), and micronutrients.

Micronutrients tracked: calcium, iron, zinc, magnesium, sodium, potassium,
vitamin A, B1, B2, B3, B6, B12, C, D, folate.

All rules come from the PRD/reference specification and are encoded as testable
deterministic rules.

### Food database

IFCT 2017 is the primary source. Records carry food code, names, category, diet
type, region tags, energy, protein, fat, carbohydrate, fibre, micronutrients,
tags. Searchable and filterable by category, diet type, and region.

Nutrition data belongs in the database/reference layer — never hardcoded
throughout application code.

### Food frequency parser

Parses practitioner free text such as:

> "2 rotis with oil, rice with dal, aloo sabzi, 1 glass milk twice a day,
> chicken 3 times a week, chai 2 cups daily."

Identifies foods and quantities, normalizes units, handles cooked vs raw,
applies food-specific density rules, recognizes combinations, applies
preparation adjustments and frequency multipliers, maps to the food database,
and produces an auditable itemized breakdown.

Units: cup, glass, bowl, piece, slice, tsp, tbsp, g, ml, handful.

Parsing may be assisted; the resulting **values** always come from the database
and deterministic calculation.

### Meal plan generator

Weekly plan: 7 days × 5 meal slots — breakfast, mid-morning, lunch, evening tea,
dinner. Built from meal templates that enforce Indian meal structure
(staple + protein + vegetable).

Respects diet type, allergies, exclusions, region, physiological tags, calorie
target, practical portion sizes, and swappable options.

Deterministic. It never asks an LLM to invent meals.

### Plan editor

Edit quantity, replace/remove/add food, edit meal options, guidelines, and
beneficial drinks. Nutrition recalculates after changes.

**Plans are versioned** (v1 → v2 → v3). Historical plans are never silently
overwritten.

### PDF export

Practitioner name, clinic name, logo, client name, week, meals, food quantities,
household quantities, guidelines, beneficial drinks, optional disclaimer.
Exportable by the practitioner and downloadable by the client.

### Client portal

Today's meals, weekly plan, meal options, plan PDF, guidelines, logging,
progress. The client never edits the practitioner's plan.

### Client logging

Food ("had 2 rotis with dal" — parsed by the same system), adherence
(followed / swapped / skipped), weight, optional measurements (waist, hip), and
free-text notes (bloating, cravings, fatigue, cycle notes).

**Logs are timestamped and append-only.** Historical entries are never silently
overwritten.

### Practitioner analytics

Dashboard: client count, plan status, last login, last logged date, adherence %,
weight trend, attention flags.

Client detail: targets, adherence heatmap, weight trend, measurement trends,
meal skip frequency, meal swap frequency, full log timeline.

### Deterministic flag engine

A rule engine, **not an AI decision maker.** Examples: weight plateau for 2+
weeks; meal skipped >50%; adherence <40%; symptom keyword detected;
physiological stage boundary approaching.

Flags surface to the practitioner. The system never automatically changes a
client's diet — the practitioner decides.

### Subscriptions

Belongs to Organization. Tiers: Free (up to 5 active clients, limited usage),
Professional (higher limits, client portal, analytics, PDF, full practitioner
functionality), Clinic (multiple dietitians, team features), Enterprise (custom
limits, integrations, dedicated support).

Pricing is decided separately and is **never hardcoded** — use a configurable
subscription/plan system.

### Super Admin

Organizations, users, subscriptions, payments, revenue, support, food database
management, reference data management, feature flags, platform analytics, audit
logs.

---

## 8. Architecture

Multi-tenant SaaS. **Every organization is isolated from every other.**
Organization A must never reach Organization B's clients, plans, logs, reports,
settings, or subscription data.

Isolation is enforced at both layers: server-side authorization **and**
PostgreSQL Row Level Security. Frontend filtering is never sufficient, and
neither layer alone is acceptable.

### Separation of concerns

```
UI → API / Server Action → Zod Validation → Service / Business Logic
   → Repository / Database Access → PostgreSQL
```

Example — create a client:

```
UI → API → Zod Validation → Client Service → Prisma → PostgreSQL
```

Business logic does not live in API route handlers or React components.

### Target code structure

Feature-oriented. This is the **target**, not what exists today:

```
src/
  app/
  components/
  features/
    auth/  organizations/  clients/  nutrition/  foods/
    plans/  portal/  analytics/  subscriptions/
  services/
  lib/
  validations/
  types/
  config/
```

The structure may evolve; business logic staying out of UI components may not.

### Anti-goals

No microservices, Kubernetes, Kafka, Redis, separate Express backend, or complex
event buses — unless an actual requirement appears. We are a startup. Prefer
simple, maintainable, production-ready architecture that can scale later.

---

## 9. Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js, TypeScript, Tailwind CSS, shadcn/ui, Lucide |
| Forms / validation | React Hook Form, Zod |
| Data fetching | TanStack Query |
| Client state | Zustand — only where genuinely needed |
| Backend | Next.js Route Handlers / Server Actions |
| Database | PostgreSQL on Supabase Cloud |
| ORM | Prisma |
| Auth | Supabase Auth |
| Storage | Supabase Storage |
| Hosting | Vercel |
| Source control | GitHub |
| Payments | Razorpay (India) first, Stripe later |
| Email | Resend (when email is implemented) |

Do not introduce a separate backend server unless a real requirement appears.

---

## 10. Development rules

1. **Don't jump phases.** Implement only the current phase. Never start future
   features automatically.
2. **Inspect before changing.** Read the file, understand the architecture, and
   preserve existing behaviour before modifying.
3. **Don't overwrite working code.** Prefer small, focused changes.
4. **No fake implementations.** No fake APIs, fake nutrition values, fake
   payment success, or placeholder logic that looks production-ready. Anything
   intentionally mocked is clearly labelled as mock/test data.
5. **No invented nutrition data.** Never invent nutrient values. Never put
   arbitrary numbers in seed files. Reference data comes from approved sources.
6. **Security first.** Never expose service-role keys, database passwords, or
   secrets. Never put secrets in client-side code.
7. **Multi-tenant security from day one.** Enforce authorization server-side and
   in the database. Never assume frontend filtering is enough.
8. **Healthcare data is sensitive.** Design for consent, access control,
   auditability, data export, deletion workflows, encryption, and minimal
   exposure.
9. **TypeScript strictness.** Avoid `any` without a documented reason. Prefer
   proper types and validation.
10. **Reusable components.** Don't duplicate common UI.
11. **Business logic in services/domain modules,** not in React components.
12. **Test critical calculations.** Every nutrition rule eventually gets an
    automated test.
13. **Keep dependencies minimal.** Don't install a library for something the
    existing stack handles easily.
14. **Don't over-engineer.** Simple architecture that can scale.
15. **Explain important architectural decisions** — what, why, alternatives, and
    why it fits Vyom. Never introduce major architectural changes silently.

---

## 11. Success criteria

The finished product lets a dietitian create a practice, add a client, enter
intake, calculate nutrition targets, enter food frequency, generate a defensible
Indian diet plan, edit and approve it, export a PDF, invite the client, watch
the client log meals and weight and symptoms, see progress, receive
deterministic flags, revise the plan, and continue the next cycle.

The whole workflow must be secure, auditable, multi-tenant, maintainable, and
production-ready.
