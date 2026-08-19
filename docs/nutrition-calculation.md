# Nutrition calculation

How Vyom turns a food, a portion, and a quantity into nutrient amounts — and
what it refuses to do along the way.

> **This engine calculates nutrition from reference data. It does not provide
> clinical recommendations.** It reports what a published source says is in an
> amount of food. It does not decide what anyone should eat, does not classify a
> person, and does not produce targets. Those are clinical judgements and belong
> to a practitioner.

---

## The one formula

```
amount = publishedValue × effectiveGrams / basisQuantity
```

That is the entire engine. There is no branch for protein, none for energy, and
none for any micronutrient. A nutrient is a code, a unit, a published figure and
a basis, and the same three operations serve all forty of them.

Adding vitamin B12 when a source finally publishes it is a **data** change. No
arithmetic changes.

```
Food ─┬─> FoodNutrient (value, basisQuantity)  ─┐
      └─> FoodServing  (weightGrams)            │
                                                ▼
quantity + unit ──> effectiveGrams ──> calculate ──> nutrients + provenance
```

### Worked example

| | |
|---|---|
| Food | Khichdi, cooked |
| Serving | 1 bowl |
| Serving weight | 173.4 g *(from the source, not assumed)* |
| Quantity | 2 |
| Effective weight | 346.8 g |
| Protein, published | 4.2 g per 100 g |
| Calculation | `4.2 × 346.8 / 100` |
| Result | 14.5656 g, displayed as **14.57 g** |

---

## Serving conversion

Grams are the only internal unit. Everything resolves to grams before a single
nutrient is calculated, because every stored value has a weight basis and there
is no other common ground.

| Unit | Conversion |
|---|---|
| `GRAM` | `effectiveGrams = quantity` |
| `SERVING` | `effectiveGrams = quantity × FoodServing.weightGrams` |

**Those are the only two units.** Not because more are hard, but because no
other unit can be converted honestly today. `lib/nutrition/units.ts` defines
katori, cup, bowl, glass, piece, and handful — and seeds **no** gram equivalent
for any of them, because a katori of dal and a katori of rice do not weigh the
same. A household measure reaches the engine as a `FoodServing` whose weight a
source published, never as a unit with an assumed factor.

### Weights are never invented

A serving converts to grams only when `FoodServing.weightGrams` is set. There is
no fallback, no average, and no default. Where a source named a portion without
publishing its weight, the engine returns `SERVING_WEIGHT_UNAVAILABLE` and the
UI says so.

`weightMethod` records how the weight was established, and the result carries it
through so a practitioner can tell a published weight from a derived one:

| `weightMethod` | Meaning |
|---|---|
| `PUBLISHED` | The source stated the weight outright |
| `DERIVED_FROM_SOURCE` | Recovered from the source's own per-100 g and per-serving figures |
| `UNKNOWN` | A label with no weight behind it — not usable |

### The basis is read, never assumed

`basisQuantity` is a column on every `FoodNutrient` row, and the formula divides
by it. Every currently imported value is per 100 g, but nothing hard-codes that:
a source publishing per-serving figures read as per-100 g would be wrong by an
unknown factor in every downstream number.

---

## Zero is not missing

The distinction the whole design protects:

| | Meaning | Representation |
|---|---|---|
| **Zero** | The source measured it and found none | A `FoodNutrient` row with `value = 0` |
| **Missing** | The source did not publish a figure | **No row at all** |

A missing nutrient produces **no entry** in the result — never a zero. Zeros are
calculated like any other value. Both are real in the current data: 2,661 stored
values are an explicit zero, and two nutrients are absent for every food.

The result names what is missing rather than leaving it to be inferred:

```ts
result.unavailableNutrients  // ["VITAMIN_B12", "VITAMIN_D"]
```

---

## Precision and rounding

**Internal precision and display precision are separate, and only one of them is
ever stored or returned.**

All arithmetic runs on decimal.js (`Prisma.Decimal`), not on JS numbers. Values
cross every boundary as decimal **strings**. `0.1 + 0.2` is not `0.3` in binary
floating point, and a clinical figure must not acquire error the source never
had.

Multiplication comes before division, deliberately: multiplying two decimals is
exact, so the division is the only step that can round — and with a 100 g basis
it is exact too.

Rounding happens in exactly one place, `lib/nutrition/calculate/format.ts`, at
the moment of display:

| Unit | Decimals |
|---|---|
| kcal, kJ, IU | 0 |
| everything else, ≥ 100 | 0 |
| everything else, < 100 | 2 |

```
engine:  22.537500      ← returned, never rounded
screen:  22.54 g        ← formatter only
```

A rounded figure is never fed back into a calculation and never stored, so no
total is ever built from rounded parts.

---

## Provenance

Every result carries where its numbers came from. This is not decoration: a
calculated nutrient figure without its source is exactly what the project's
prime directive exists to prevent.

```
Food ──> FoodNutrient ──> NutritionSourceVersion ──> NutritionSource
                                (release)               (publisher, licence)
```

The result exposes the source code and name, the release label, the publisher's
own record id for the food, the licence permission status, and — per nutrient —
the published figure, its basis, and the source's own nutrient code. That is
everything a future "why this number?" view needs, without another query.

### Source selection: one release per calculation

A food may carry the same nutrient from more than one release —
`FoodNutrient` is unique on `(food, nutrient, sourceVersion)`, which is what lets
IFCT 2017 and a later revision coexist without either overwriting the other.

When that happens, the engine picks **one** release and reads only that one:

1. the release the canonical food was derived from, if it has values
2. otherwise the highest-priority source, by `NutritionSource.priority`
   (`PRIMARY_INDIAN` → `SECONDARY_INDIAN` → `SUPPLEMENTARY_INTERNATIONAL`)
3. ties broken on the version label descending, then on id

Values are **never** averaged, merged, or mixed per nutrient. If two sources
disagree about a food's protein, the answer is one of those figures with its
source named — not a third number that no publisher ever printed.

Servings are filtered to the same release, and not for tidiness: 916 of the 917
imported serving weights are `DERIVED_FROM_SOURCE`, recovered from that release's
own figures, so pairing one with a different dataset's composition would be a
real error.

Only one dataset is imported today, so nothing currently competes. The rule
exists so the second one cannot arrive and quietly change every number.

---

## Aggregation, and no false completeness

Several calculated foods sum into one total. A nutrient is summed **only over the
items that published it**, and every total says how much of the meal it covers:

| Completeness | Meaning |
|---|---|
| `COMPLETE` | Every item published this nutrient |
| `PARTIAL` | At least one did not — the figure is a floor, not a total |

Adding four foods when three published iron gives a real number that is *not* the
iron content of those four foods. Presenting it as one would be a claim the data
does not support, so the result carries `contributingItems`, `totalItems`, and
`missingFrom` alongside the value.

A nutrient **no** item published does not appear as a total at all — it appears
in `unavailableNutrients`. A zero there would be a fabricated value.

Aggregation refuses outright to total one nutrient recorded in two different
units: summing milligrams into grams is wrong by a factor of a thousand and looks
entirely reasonable on screen.

---

## Errors

Failures are **values, not exceptions** — following `lib/assessments/bmi.ts`. A
food with no serving weight is an ordinary state of the data that a screen has to
render, not something to catch.

| Code | Cause |
|---|---|
| `INVALID_QUANTITY` | Zero, negative, non-numeric, or past the technical bound |
| `UNSUPPORTED_UNIT` | A unit outside `GRAM` / `SERVING` — never silently converted |
| `SERVING_REQUIRED` | `unit = SERVING` with no serving identified |
| `FOOD_NOT_FOUND` | No such food, or it is deactivated |
| `SERVING_NOT_FOUND` | No such serving |
| `FOOD_SERVING_MISMATCH` | The serving belongs to another food, or another release |
| `SERVING_WEIGHT_UNAVAILABLE` | The source published no weight for that portion |
| `NUTRITION_DATA_UNAVAILABLE` | The food carries no nutrient values |
| `NUTRIENT_VALUE_INVALID` | A stored value or basis could not be read |

Messages are safe to display and contain no identifier, table name, or driver
detail.

### Technical bounds are not clinical limits

`MAX_QUANTITY` (10,000) and `MAX_EFFECTIVE_GRAMS` (100,000) exist so a
hand-crafted request cannot drive the arithmetic into absurd magnitudes. **They
say nothing about how much of a food a person should eat** and must never be
presented as a recommendation.

---

## Architecture

```
UI (server component)
  ↓ requireClinicalContext()
services/nutrition/calculate.ts      ← loads rows, picks the release, provenance
  ↓ plain data
lib/nutrition/calculate/*.ts         ← PURE: no prisma, no server-only, no I/O
  ├─ grams.ts       quantity + unit + serving → effective grams
  ├─ nutrients.ts   the formula, applied generically
  ├─ aggregate.ts   summation + completeness
  ├─ format.ts      display rounding, and nothing else
  └─ types.ts       result shape and typed errors
```

The split is what makes the maths testable without PostgreSQL. The service
performs no arithmetic; the pure modules touch no database.

**No nutrition calculation happens in a React component.**

### Nothing is persisted

A calculation is **derived** data. `FoodNutrient` is the stored fact; this is
arithmetic over it.

| | |
|---|---|
| Food composition | Persistent reference data |
| Calculated nutrition | Derived, transient |

Writing results to a table would create copies that go stale the moment a source
version is corrected or re-imported, and no product requirement needs them yet.
When meals become real entities they will store their **inputs** — food, serving,
quantity — and recalculate from those. **Phase 8C added no model and no
migration.**

---

## Security

Nutrition reference data is **global**. No table here has an `organizationId`,
and `calculateFoodNutrition()` takes none — there is no per-tenant food data to
scope to. This is the one intended cross-tenant read in the product.

It is still clinical by audience. Two independent layers enforce that:

- **Server** — pages call `requireClinicalContext()` before reaching the service
- **Database** — RLS grants `SELECT` only, gated on
  `vyom_private.is_clinical_user()`, on every nutrition table

The engine performs **no writes**. No user can modify global reference data
through this feature, and a test asserts the row count is unchanged after a
calculation.

---

## Known limitations

**These are facts about the current data, not placeholders.**

- **Vitamin B12 is unavailable for every food.** INDB 2024.11 does not publish
  it. It is reported as unavailable, never as zero.
- **Vitamin D is unavailable for every food.** The source publishes D2 and D3
  separately and states no total. Nothing sums them — a total would be a derived
  value the source did not state.
- Those two account for exactly the 2,028 absent values (2 × 1,014 foods).
  The other 38 nutrients are populated for all 1,014.
- **97 of 1,014 foods have no serving at all** and can only be calculated by
  weight.
- **One serving has no published weight** and cannot be used by serving.
- **916 of 917 serving weights are `DERIVED_FROM_SOURCE`**, not published
  outright. `agreementSpread` records how firmly the source implied each one.
- **No dataset is cleared for commercial use.** Every source is
  `DEVELOPMENT_ONLY` with `UNKNOWN` commercial-use and redistribution status, and
  the UI says so beside the numbers. See [nutrition-data.md](nutrition-data.md).
- Only `GRAM` and `SERVING` are supported. Household units await published
  portion references.
- Energy is taken from the source and never derived from macronutrients. Where a
  source publishes no energy, the engine reports none rather than manufacturing
  a second opinion.

---

## What this phase deliberately did not build

BMR, TDEE, activity factors, calorie targets, macro targets, protein targets,
meal-plan generation, BMI classification, and any clinical recommendation.

Those need reference values — Asian-Indian BMI cutoffs, activity factors, goal
adjustments, protein g/kg, RDAs — that come from the PRD and **are not in this
repository**. See [nutrition-assessment.md](nutrition-assessment.md).

The engine is the input to that work, not a substitute for it.
