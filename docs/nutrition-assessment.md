# Nutrition assessment

Phase 6 answered *who is the client*. This answers *what is their current
nutrition situation, and what are they trying to achieve*.

---

## Architecture

```
Organization
  └── Client
        ├── NutritionAssessment  (INITIAL,   14 Aug, completed)
        ├── NutritionAssessment  (FOLLOW_UP, 20 Sep, completed)
        └── NutritionAssessment  (FOLLOW_UP, 20 Oct, draft)
```

A client accumulates assessments. Each is a **separate record of one
consultation**; a follow-up creates a new row and never overwrites the previous
one. The value of this data is the trend across visits, and an overwrite
destroys exactly that.

Assessment data lives here, **never on `Client`**. That model stays identity,
contact, and administrative details — which is what keeps a receptionist able to
manage a client record without being able to read their medical history.

`createdByMemberId` references the **membership**, not the user: attribution
belongs to a role within one practice, and the same person may work at several.

---

## Lifecycle

```
create → DRAFT ⇄ (edit) → COMPLETED → (edit)
```

Two states only. Approval and review workflows are not how a dietitian works,
and inventing them would add ceremony nobody asked for.

**A draft may be incomplete, never invalid.** Anything actually entered is
validated in both schemas — storing "-5 kg" under the draft exemption would let
it become permanent the moment the assessment is completed.

| | Required |
|---|---|
| **Save draft** | Assessment date, type |
| **Complete** | …plus height, weight, primary goal |

Nothing else is required. Not every consultation surfaces every detail, and
forcing a dietitian to invent a value to get past a form is how bad data enters
a clinical record.

A completed assessment stays editable — correcting a mistyped weight should not
require a new consultation record. Completion is one-way: nothing demotes a
signed-off assessment back to draft, and `completedAt` keeps its original value
through later edits (`updatedAt` covers those).

A database CHECK enforces that `COMPLETED` always has a `completed_at` and
`DRAFT` never does, so the two cannot contradict each other.

---

## Sections

1. **Assessment** — date, type
2. **Measurements** — height, weight, derived BMI
3. **Health background** — conditions, history, medications, allergies
4. **Lifestyle** — activity level, exercise, occupation, sleep, water
5. **Diet** — diet type, preferences, dislikes, avoidances, restrictions
6. **Goals** — primary goal, notes
7. **Consultation notes** — free text

One page of labelled sections, not a wizard. A dietitian fills this in during a
consultation, often out of order as the conversation goes; a wizard forcing a
sequence would fight the work.

### Allergies are not preferences

Three distinct concepts, three distinct fields:

| Concept | Example | Why separate |
|---|---|---|
| Allergy / intolerance | "Peanut allergy" | A safety constraint |
| Food disliked | "Doesn't like mushrooms" | A preference |
| Food avoided | "Avoids beef" | A choice |

Merging them would let a future meal planner treat a dislike as clinically
equivalent to an allergy.

### Health fields are free text

Conditions, history, and medications are recorded as the clinician wrote them.
A coded terminology system (SNOMED, ICD) is a serious undertaking and would be
premature here — and a nutrition assessment *is* largely what the practitioner
observed and was told.

No drug database, dosage calculator, or interaction checker. Those are a
different product.

---

## BMI

```
BMI = weight_kg / (height_cm / 100)²
```

170 cm, 70 kg → **24.2**

**Derived on read, never stored.** A stored copy drifts out of step the moment
either measurement is corrected. There is no `bmi` column, and a submitted BMI
is stripped by validation.

### It returns a number and nothing else

No category, no "healthy" or "overweight" label, no colour. Two reasons:

1. **Asian-Indian BMI cutoffs differ from WHO defaults** and come from the PRD,
   which is not in this repository. Applying WHO thresholds to Indian clients
   would be actively wrong, and inventing thresholds would violate the project's
   prime directive: never guess a clinical number.
2. Classifying a person from BMI alone is a clinical judgement. This product
   records data for a practitioner; it does not diagnose.

When the cutoffs are supplied, classification belongs in its own module with its
own tests.

### Edge cases

`calculateBmi` returns `{ available: false }` — never `0` — for missing height,
missing weight, zero height, negatives, non-finite values, and measurements
outside physiological bounds. A displayed "0.0" reads as a measurement, and a
falsy number invites `bmi || "—"` to hide a real one.

### Units

Canonical storage is **centimetres and kilograms**, as `NUMERIC(5,1)`.

Never `"5'8\""` or `"70 kg"` as text — a formatted string cannot be compared
across visits or converted for display. Never `double precision` either: binary
floating point cannot represent 70.1 exactly, and a measurement must survive a
round trip. A test asserts it does.

`assessment_date` is a `DATE`: a consultation happened on a calendar day, not at
an instant. Storing it as a timestamp would shift it across midnight for some
users. `created_at`, `updated_at`, and `completed_at` are timestamps and mean
something different.

---

## Permissions

| | OWNER | DIETITIAN | RECEPTIONIST | CLIENT |
|---|---|---|---|---|
| View assessments | All in practice | **Own caseload** | **No** | No |
| Create / edit / complete | ✓ | ✓ | **No** | No |

**The receptionist boundary is the defining access decision of this phase.** A
receptionist may create and manage client records — they take details at the
front desk — and must not read a single health field. They have no clinical
reason to, and the data is the most sensitive in the product.

Enforced in three places:

1. `requireClinicalContext()` throws `ForbiddenError` for RECEPTIONIST and
   CLIENT before a page renders.
2. The RLS policy uses `vyom_private.current_clinical_organization_ids()`, which
   filters on `role IN ('OWNER','DIETITIAN','SUPER_ADMIN')` — deliberately
   narrower than the `current_staff_*` helper the other tables use.
3. The client profile does not fetch assessments at all for a receptionist, so
   their page load carries no health data to hide.

Hiding a navigation link is none of those.

A dietitian sees assessments for **their own caseload**, using the same
assignment rule Phase 6 applies to clients, so the two views cannot disagree.

`SUPER_ADMIN` has no operational assessment UI. Platform administration and
practice clinical workflow are different products.

---

## Security

### Tenant isolation

`organizationId` is denormalised onto the assessment so every policy and query
can scope on it without a join. Two independent foreign keys cannot express
"these must agree", so a **trigger** enforces it: an assessment's organization
must match its client's *and* its author's.

Without that, a bug could file an assessment under practice A against practice
B's client — and RLS, which scopes on `organization_id`, would show it to the
wrong practice.

### What the payload cannot carry

`organizationId`, `clientId`, `createdByMemberId`, `status`, `completedAt`, and
`bmi` are absent from every schema, so Zod strips them. Completion is decided by
**which button was pressed**, not by a field in the request.

The organization comes from the session; the client is verified to belong to it
before use; the author is the caller's own membership.

### IDOR

`getAssessment` is scoped by organization and caseload. An assessment from
another practice returns `null`, the route renders not-found — identical to an
id that never existed, so it cannot be used to discover which assessments exist.

### Writes

RLS grants `SELECT` only. There is no INSERT, UPDATE, or DELETE policy or grant,
so the Supabase client cannot write an assessment by any path.

### Privacy

Nothing in the service logs a field value; error logs carry ids only. Assessment
history is not exposed through the client list, search, or navigation payloads —
a list response should not carry health detail the list does not display.

Health information is not searchable: there is no way to query clients by
condition, medication, or allergy in this phase.

All test and development data is synthetic.

### Retention

All three foreign keys are `RESTRICT`. Archiving a client leaves their
assessment history untouched, and restoring them brings it back intact. A test
covers both directions.

---

## Interface

| Route | Purpose |
|---|---|
| `/clients/[clientId]` | Nutrition section — history, newest first |
| `/clients/[clientId]/assessments/new` | New assessment |
| `/clients/[clientId]/assessments/[id]` | Full detail |
| `/clients/[clientId]/assessments/[id]/edit` | Continue a draft, or correct a completed one |

History is a timeline, not a table: these are consultations, and what matters is
when each happened and how the measurements moved. It shows metadata and
measurements only — health detail lives on the detail page.

BMI updates live in the form as height and weight are typed, and is displayed
rather than submitted.

---

## Not implemented in Phase 7

Meal plans · meal-plan generation · food database · calorie, protein, or macro
recommendation engines · progress charts · consultations · appointments · client
portal · client authentication · billing · subscription limits · email · **any
AI**.

No calorie, macro, TDEE, or BMR value is stored or derived. Doing so requires
reference values — activity factors, protein g/kg, goal adjustments — that come
from the PRD and are not in this repository. A verification asserts no such
column exists.

Activity level and primary goal are **recorded, never acted on**. Nothing
multiplies the activity level by anything or turns a goal into a target.

### Future audit events

`assessment_created`, `assessment_updated`, `assessment_completed`.

### What later phases can read

Meal planning will need the latest assessment's goals, dietary preferences,
allergies, lifestyle, and measurements. All of that is available from
`getLatestAssessment` without touching the `Client` model.

---

## Files

| Path | Role |
|---|---|
| `src/app/(dashboard)/clients/[clientId]/assessments/**` | New, detail, edit |
| `src/components/assessments/**` | Form, history timeline |
| `src/lib/assessments/actions.ts` | Server Actions — authorization boundary |
| `src/lib/assessments/bmi.ts` | BMI calculation |
| `src/services/assessments.ts` | Scoped queries and writes |
| `src/validations/assessment.ts` | Draft and completion schemas |
