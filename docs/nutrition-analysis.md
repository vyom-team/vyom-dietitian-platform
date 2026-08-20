# Nutrition analysis

How a planned day is totalled and compared against a client's targets — the
bridge between the food engine and the requirement engine.

> **Deterministic and composed, never recalculated.** This layer computes no
> nutrient amount and no target. Both arrive from engines that own them, with
> their own provenance, and this layer only relates the two.

---

## What answers what

```
Phase 8C   what is in this food          calculateFoodNutritionBatch
Phase 8C   what do these foods total     aggregateNutrition
Phase 8D   what does this client need    getNutritionTargets
Phase 8E   how do those two relate       compareNutrient
```

One source of truth per number. A wrong figure is traceable to exactly one
engine, and the nutrition formula exists in exactly one place.

```
plan items → 8C batch → per-item results → aggregate → day totals
                                                          │
client → assessment → 8D targets ─────────────────────────┤
                                                          ▼
                                              comparison (8E)
                                     gap · percentage · status · coverage
```

---

## What is stored, and what is not

| Stored | Derived on every read |
|---|---|
| food, serving, quantity, unit, meal slot | energy, macros, micronutrients |
| pinned source release per item | percentages, gaps, statuses |
| pinned assessment per plan | coverage, provenance |

**No total is ever written back.** That is not only a staleness guard — it is
what makes recalculation automatic. There is no cached figure that could
disagree with the items, so changing a quantity and re-rendering *is* the
recalculation. The UI has no "Calculate" button because there is nothing to
refresh.

A test asserts that `nutrition_plans` and `nutrition_plan_items` carry no
column named for a nutrient.

---

## Reproducibility

Two pins keep a reviewed plan explainable later:

- **`NutritionPlanItem.sourceVersionId`** — which food release the values were
  read from when the item was added, so a later dataset import cannot silently
  change a plan somebody already reviewed.
- **`NutritionPlan.assessmentId`** — which assessment supplied the targets, so
  editing a client's weight does not retroactively change what a plan was
  measured against.

---

## Comparison

For every nutrient: `target`, `actual`, `remaining`, `percentage`, `status`,
and `coverage`.

```
remaining  = target − actual          (negative means the plan exceeds it)
percentage = actual / basis × 100
```

### Status is mathematics, not medicine

| Status | Meaning |
|---|---|
| `BELOW_TARGET` | Less than the target, or below a range's floor |
| `TARGET_MET` | Exactly equal, or inside a published range |
| `ABOVE_TARGET` | Exceeds the target, or a range's ceiling |
| `TARGET_UNAVAILABLE` | Phase 8D has no licensed reference |
| `DATA_UNAVAILABLE` | No food in the plan publishes this nutrient |
| `INCOMPARABLE_UNITS` | Both exist but cannot be related |

**`BELOW_TARGET` does not mean deficient. `ABOVE_TARGET` does not mean
excessive.** Exceeding an Adequate Intake is a different event from exceeding a
Tolerable Upper Intake Level, so the reference's own `valueType` travels with
every comparison and this layer declines to interpret it. That belongs to a
later rules phase.

**There is no tolerance band.** `TARGET_MET` is exact equality; 99.4% of a
target reports as `BELOW_TARGET`. Deciding that ±5% is "close enough" is a
clinical judgement this project does not invent, and the percentage carries the
nuance a band would have hidden.

### Ranges

A published range stays a range. Inside the band is `TARGET_MET`; `remaining` is
measured against whichever bound was crossed; the percentage is measured against
the **floor**, and says so via `percentageBasis`. There is no midpoint, because
the publisher declined to name one.

### Division by zero

A zero basis yields **no percentage at all** — not zero, not infinity, not NaN.
Every one of those would render as a number somebody could act on.

---

## The unit trap

Phase 8C reports a nutrient in `MG`. Phase 8D reports a requirement in
`MG_PER_DAY`. Those correspond; `G` and `MG_PER_DAY` do not.

Compatibility is an explicit four-entry table and **this engine converts
nothing**:

```
KCAL_PER_DAY ↔ KCAL      G_PER_DAY ↔ G
MG_PER_DAY   ↔ MG        UG_PER_DAY ↔ UG
```

Anything else is `INCOMPARABLE_UNITS`, with both sides still shown so a reader
can see the mismatch. Silently treating 850 mg as 850 g would be wrong by a
factor of a thousand and look entirely reasonable on screen.

`KJ` and `IU` have no reference-unit counterpart. `G_PER_KG_PER_DAY` is resolved
to `G_PER_DAY` by Phase 8D before it becomes a target; one arriving here
unresolved is a bug, not something to multiply by a body weight again.

---

## Missing is never zero

Three different absences, shown differently because they need different
responses:

| | Meaning | Whose gap |
|---|---|---|
| `TARGET_UNAVAILABLE` | No licensed reference | Vyom's licensing |
| `DATA_UNAVAILABLE` | No food publishes it | The dataset |
| `INCOMPARABLE_UNITS` | Cannot be related | A data fault |

A nutrient no food published has **no `actual` field at all**. A failed item is
excluded from the totals and reported separately rather than counted as zero,
which would understate every nutrient in the plan.

### Partial coverage

Phase 8C's `COMPLETE` / `PARTIAL` is preserved as its own dimension rather than
folded into `status` — a partial total can still be meaningfully below a target,
and collapsing the two would lose one of them. A partial figure is **a floor,
not a total**: at least one food published nothing, so the real amount is higher
by an unknown quantity. The comparison carries `contributingItems`,
`totalItems`, and `missingFrom` so a screen can say which.

---

## Precision

Identical to 8C and 8D. Decimal throughout, values cross boundaries as strings,
and **no individual food value is rounded before aggregation**. Rounding happens
once, in the display components.

---

## Performance

`calculateFoodNutritionBatch` loads every distinct food in a plan with one
query and reuses each across the items that reference it — the same food at
three quantities costs one fetch. A day of twenty items is one round trip, not
twenty.

One unusable item does not fail the batch: a plan with a broken row still totals
the other nineteen.

---

## Security

A plan is built from a client's clinical targets and is **tenant-owned clinical
data**, unlike the global food and reference tables.

- `requireClinicalContext()` on every page and Server Action — OWNER and
  DIETITIAN only; RECEPTIONIST, CLIENT and anonymous refused
- Services take `organizationId` **as a parameter**, from that call and never
  from a form field; every query filters on it
- RLS on both tables uses `current_clinical_organization_ids()` — the clinical
  helper, not the staff one — so a receptionist reads no row
- `nutrition_plan_items` carries no `organization_id` of its own; the policy
  reaches through the plan rather than duplicating a column to keep consistent
- A database trigger refuses a plan whose organization, member, or assessment
  belongs to someone else

---

## Licensing

Unchanged. Food values remain `DEVELOPMENT_ONLY`, and the source and its
permission status are shown beside every total.

---

## What this phase does not do

No dietary rules, allergy handling, or diet-type filtering (8F). No templates or
automated planning (8G). No review or publishing (8H). No food recommendations,
no AI, and no new reference value of any kind.

The output is deliberately shaped for those phases to consume: `remaining` per
nutrient is exactly what a later selector needs in order to propose a food, and
this layer stops short of proposing one.
