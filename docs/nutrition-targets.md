# Nutrition targets

How Vyom decides how much a client needs — and, far more often today, why it
declines to say.

> **Nutrition targets are deterministic and reference-backed. The engine does
> not generate, infer, or estimate a clinical value it cannot cite.**
> It makes no clinical recommendation, classifies nobody, and replaces no
> practitioner judgement.

---

## Read this first: almost nothing is calculable yet

**Eight of the nine target types return `REFERENCE_REQUIRED`.**

That is the accurate state of this repository, not an unfinished feature. The
ICMR-NIN *Recommended Dietary Allowances and Estimated Average Requirements*
(2020) is registered as a source, is marked `PERMISSION_REQUIRED`, and **has not
been acquired**. See [`data/nutrition/README.md`](../data/nutrition/README.md).

| Target | Status | Needs |
|---|---|---|
| Resting energy (BMR) | ✅ **Calculated** | Mifflin-St Jeor (published equation) |
| Total energy expenditure | ❌ `REFERENCE_REQUIRED` | Activity factors |
| Daily energy target | ❌ `REFERENCE_REQUIRED` | Goal adjustments |
| Protein | ❌ `REFERENCE_REQUIRED` | g/kg reference |
| Fat | ❌ `REFERENCE_REQUIRED` | % of energy |
| Carbohydrate | ❌ `DEPENDS_ON_UNAVAILABLE` | Protein + fat first |
| Fibre | ❌ `REFERENCE_REQUIRED` | g/day reference |
| Micronutrients (all 40) | ❌ `REFERENCE_REQUIRED` | ICMR-NIN RDA/EAR tables |
| BMI classification | 🚫 **Out of scope** | Asian-Indian cutoffs (PRD) |

Supplying those values is a **data** task, not a code task. The pipeline is
written in full; importing licensed rows makes each stage start working without
anyone touching the engine.

---

## The one calculable target

```
male    BMR = 10 × kg + 6.25 × cm − 5 × age + 5
female  BMR = 10 × kg + 6.25 × cm − 5 × age − 161
```

**Why this one and not the others:** an equation with a journal citation is
published knowledge; a table of requirement values is copyrighted data. The
coefficients *are* the equation's identity, so they live in code with a
citation rather than in the reference table.

> Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO.
> A new predictive equation for resting energy expenditure in healthy
> individuals. *Am J Clin Nutr.* 1990;51(2):241-247.

**Population caveat, stated on every result:** Mifflin-St Jeor was derived on a
US population. It is the method [CLAUDE.md](../CLAUDE.md) names for Vyom, and no
Indian-population resting-energy equation has been acquired. The caveat travels
with the figure rather than living only here.

### What BMR refuses to do

The equation defines constants for two sexes and no others. A client recorded as
`OTHER` or `UNDISCLOSED`, or with no sex recorded, gets **no BMR** —
`POPULATION_UNSUPPORTED`, never a male default. That substitution would make a
woman's figure wrong by 166 kcal every day, which is exactly the size of the
difference between the two constants.

---

## The pipeline

```
BMR ──× activity factor──> expenditure ──± goal adjustment──> energy target
                                                 │
                      ┌──────────────────────────┼──────────────┐
                      ▼                          ▼              ▼
                 protein (g/kg)           fat (% energy)   fibre (direct)
                      └──────────────┬───────────┘
                                     ▼
                        carbohydrate (remaining energy)
```

Atwater general factors (protein 4, fat 9, carbohydrate 4 kcal/g) convert an
allocation a reference has already defined. They never *create* one — without a
licensed fat-percentage rule there is nothing to convert.

---

## Reference architecture

Requirements reuse the Phase 8A provenance spine rather than duplicating it:

```
NutritionSource ──< NutritionSourceVersion ──< ReferenceRule
   (publisher,          (one release)           (one requirement,
    licence)                                     with applicability)
```

`reference_rules` is **global reference data**: no `organizationId`, `SELECT`
only for clinical users, writable by no application role. Same posture as
`foods` and `food_nutrients`.

**One table, not `Rule` + `Value`.** A rule and its value are one-to-one — "iron
RDA for women aged 19-49" is a single number. A rule that varies by age or sex is
a *different row* with different applicability, which is what makes resolution a
query rather than a chain of conditionals.

### Applicability and resolution

Selection is a filter plus a ranking, never an if/else chain:

1. Filter to the rule type (and nutrient, for micronutrients)
2. Keep only rules whose sex, age band, and physiological state apply
3. Rank: **sex-specific beats `ANY`**, then **narrower age band beats wider**
4. Tie-break on rule id, so the same inputs always select the same rule

**No near misses.** A 17-year-old never receives an adult rule that starts at 18.
An age-bounded rule is never applied to a client whose age is unknown. A
sex-specific rule is never applied when the recorded gender does not map onto a
reference population.

### Value semantics are preserved

`RDA`, `EAR`, `AI`, `UL`, `RANGE`, `FACTOR`, `EQUATION` are distinct and never
relabelled. An Adequate Intake displayed as an RDA would misrepresent the
publisher's own confidence, and an Upper Limit is a ceiling — the opposite of a
target. A published range stays a range: there is deliberately no `value` field
on a `RANGE` target to collapse into a midpoint.

Database CHECK constraints enforce the shape — a `RANGE` with one bound, an
`RDA` with none, a micronutrient rule with no nutrient, or a negative
requirement are all rejected by Postgres.

---

## Inputs

| Input | Source | Required |
|---|---|---|
| Height, weight | `NutritionAssessment` | Required to complete an assessment |
| Activity level, goal | `NutritionAssessment` | Optional |
| Age | `Client.dateOfBirth`, derived | Optional |
| Sex | `Client.gender` | Optional |

Age is computed **in the service** and passed to the engine as a number. The
pure engine never reads a clock — a target calculated at 23:59 must not differ
from one calculated a minute later for a reason no test can reproduce.

Only the latest **COMPLETED** assessment is used. A draft may be half-filled, and
a clinical figure derived from a form somebody is still typing into would change
under them.

### Unsupported populations

**Pregnancy and lactation are not supported.** The assessment model captures no
physiological state, and inferring pregnancy from sex or lactation from age is
precisely the guess this project forbids. The `PhysiologicalState` enum exists so
those rules have a correct home; resolution only ever matches `NONE`.

**No disease-specific targets.** Diabetes, renal, thyroid, PCOS and therapeutic
diets need dedicated clinical references and belong to a later phase. A test
asserts no such term appears in a profile.

---

## Precision

Identical to Phase 8C. All arithmetic on decimal.js; values cross every boundary
as decimal **strings**; rounding happens only at display.

Worth recording: the BMR equation is itself float-safe — 10, 6.25 and 5 are all
exactly representable in binary. Decimal earns its place *downstream*, where
arbitrary reference factors multiply that figure. `1617.5 × 1.63` is
`2636.5249999999996` as a float and `2636.525` as a decimal.

---

## Provenance and explainability

Every calculated target carries an ordered `explanation[]` — each term of the
derivation with its own value — plus `references[]`. A "Why is protein 70 g?"
panel needs no second query.

References are of two kinds, kept distinct so a reader can tell what stands
behind a number:

- **`PUBLICATION`** — a citable method (Mifflin-St Jeor, Atwater), with any
  population caveat
- **`DATASET`** — a licensed reference release, carrying its `permissionStatus`

A target that is `CALCULATED` always has at least one reference. A test asserts
it.

---

## Missing ≠ zero

An unavailable target has **no value field at all**. Not null, not zero — the
discriminated union makes `?? 0` unrepresentable. Five distinguishable reasons,
because they call for different responses:

| Reason | Meaning | Who fixes it |
|---|---|---|
| `REFERENCE_REQUIRED` | No licensed reference exists | Vyom (licensing) |
| `INPUT_MISSING` | A field is not recorded | The practitioner |
| `INPUT_INVALID` | A recorded value is out of range | The practitioner |
| `POPULATION_UNSUPPORTED` | References exist, none applies | Neither, today |
| `DEPENDS_ON_UNAVAILABLE` | An earlier pipeline step failed | Follows the cause |

---

## Persistence

**Nothing is stored.** Targets recalculate from the assessment on every read.

| | |
|---|---|
| Assessment measurements | Persistent clinical record |
| Reference rules | Persistent reference data |
| Targets | Derived, transient |

A stored copy goes stale the moment a measurement is corrected or a reference
version is imported. Immutable snapshots belong to the diet-plan phase — the
first thing that genuinely must remember *"what were the targets when this plan
was written"*. Phase 8D adds the versioned reference architecture that makes such
a snapshot reproducible later.

---

## Security

Unlike the food calculator, this reads **client health data** and is
tenant-scoped.

- `requireClinicalContext()` — OWNER and DIETITIAN only; RECEPTIONIST, CLIENT,
  and anonymous are refused
- The service takes `organizationId` **as a parameter**, from that call and never
  from a URL or body; every query filters on it
- A client belonging to another practice returns exactly the same response as one
  that does not exist, so the route cannot be used to discover real ids
- `reference_rules` has RLS enabled, `SELECT` only, gated on
  `vyom_private.is_clinical_user()`, and is writable by no application role

---

## Licensing status

Unchanged and unresolved. Every registered source is `DEVELOPMENT_ONLY` with
`UNKNOWN` commercial-use and redistribution status. Nothing in this codebase may
set `APPROVED` — that is a human legal determination.

The reference table shipping empty is partly a licensing fact: importing
ICMR-NIN values before clearing their terms would be the problem, not the
solution.

---

## Importing reference values

```
npm run nutrition:import-references -- --manifest icmr-rda-2020.json --dry-run
npm run nutrition:import-references -- --manifest icmr-rda-2020.json
```

A manifest maps a CSV's columns onto reference rules. Templates live at
`data/nutrition/manifests/icmr-rda-2020.example.{json,csv}` and contain **no
clinical values** — every figure has to be transcribed from the printed tables.

### What the importer refuses

- **A unit that disagrees with the nutrient dictionary.** Iron is stored in
  milligrams, so an iron requirement must be `MG_PER_DAY`. A row declaring
  `UG_PER_DAY` is rejected, never converted — between mg and µg a mistake is a
  factor of a thousand and looks entirely plausible in a table.
- **A missing unit.** Never inferred.
- **A value shape that contradicts its type** — a `RANGE` with one bound, an
  `RDA` with none, a micronutrient rule with no nutrient.
- **A negative requirement**, an inverted age band, an implausible age.
- **An unregistered source.** Registering one is a deliberate act recording
  what would have to be licensed; an importer inventing sources would undo that.

### All-or-nothing

If any row fails, **nothing is written** — not even the valid rows. A partially
imported requirement table produces targets that look complete and are not.
Run `--dry-run` first; it reports every rejection with its line number.

### What it cannot do

Importing values is **not** a licence. `permissionStatus` stays where a human
put it, and a test asserts the importer does not change it.

---

## Extending this

To support pregnancy or lactation, add the physiological state to
`NutritionAssessment` first; the resolver already matches on it, and rows
imported before that field exists would never resolve.

**Do not** hard-code a value into TypeScript to make a screen look complete.
