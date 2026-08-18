# Nutrition reference data

Where nutrition numbers come from, how they get in, and what is known about
whether we may use them.

> **Licence status: nothing here is cleared for commercial use.**
> Every dataset is registered as `DEVELOPMENT_ONLY` with `UNKNOWN`
> commercial-use and redistribution status. That is the accurate state of this
> project, not a placeholder. **Development datasets require production
> licensing and permission review before commercial launch.** This document
> makes no claim of legal clearance for any source.

---

## The one rule

**External datasets are inputs, not the application model.**

```
Raw file → Parse → Normalize → Validate → Map → Import → Database
                                                            │
                                            the rest of Vyom reads only this
```

The product talks to `Food`, `FoodNutrient`, and `Nutrient`. It never sees an
IFCT column name. That indirection is what lets a second dataset arrive without
touching anything downstream, and what stops one publisher's spreadsheet layout
from becoming Vyom's schema.

---

## Model

```
NutritionSource ──< NutritionSourceVersion ──< DatasetImport
   (publisher,            (one release)         (one ingestion run)
    licence)                    │
                                ├──< SourceFood ──> Food
                                │    (what the file said, and what it maps to)
                                │
                                └──< FoodNutrient ──> Nutrient
                                     (one value)      (the dictionary)

Food ──< FoodAlias          Unit ──< UnitConversion
```

**All of it is global.** No table here has an `organizationId`. IFCT's protein
figure for toor dal is the same fact for every practice; copying it per tenant
would multiply one dataset by the customer count and make a published correction
impossible to apply. A verification asserts no `organization_id` column exists
on any of these tables.

Organization-scoped custom foods and recipes are a later phase. They get their
own models with a real `organizationId` — not a nullable column bolted onto
these.

### Source and version are separate

`NutritionSource` is the publisher and the licence terms. `NutritionSourceVersion`
is one release.

The phase brief put `version` on the source. Splitting it is deliberate: a new
release must not corrupt existing records. Nutrient values reference the
*version*, so importing a later IFCT leaves every IFCT 2017 value intact and
still correctly attributed. One table would have forced either an overwrite or a
duplicated licence on every release, and let two versions disagree about terms.

### Food is canonical, SourceFood is what the file said

`Food` is what a dietitian picks. `SourceFood` is the dataset row it came from,
kept with its original identifier, name, category wording, and full raw payload.

Both identities survive, which is what makes an import auditable after the fact:
whatever normalisation gets wrong can be recovered without going back to the
file.

### FoodNutrient carries a basis

`basisQuantity` + `basisUnitCode`, defaulting to 100 g.

Not in the brief, but a value without one is meaningless — "protein 22.3 g" is
per what? IFCT and USDA both publish per 100 g; a per-serving dataset read as
per-100 g would be wrong by an unknown factor in every calculation later built
on it. The basis must be a canonical unit (g or ml): "per katori" cannot be
stored, because nothing could later work out what a katori weighs.

---

## Missing is not zero

The single most important rule in the pipeline.

| The source says | Vyom stores | Meaning |
|---|---|---|
| `22.3` | a row with value 22.3 | measured |
| `0` | a row with value 0 | **measured, and there is none** |
| blank, `-`, `NA` | **no row at all** | not measured |

A `FoodNutrient` row exists only when the source actually published a figure.
`value` is `NOT NULL`, so there is no null-value row to blur the two.

The distinction is clinical, not pedantic: "we do not know the iron content" and
"this food contains no iron" lead a dietitian to different decisions, and once a
blank has been written as a zero the difference is unrecoverable. Missing values
are counted separately in every import report.

A cell that is neither a number nor a declared missing-marker is an **error**,
not a silent skip — an unrecognised marker usually means the manifest is
incomplete, and dropping it quietly would hide that.

**Trace markers (`tr`, `trace`) are deliberately not treated as missing by
default.** Trace is neither zero nor absent, and representing it honestly is a
product decision nobody has made. A dataset using them must list them in its
manifest explicitly, which records the choice rather than burying it.

---

## Precision

Values are `NUMERIC(14,6)` and are carried from the file to the column **as
strings**. No published figure ever passes through a JavaScript float.

`double precision` cannot represent 0.7 exactly, and a reference value that
changes when it round-trips is not reference data. Nothing is rounded on import;
a value with more than six decimal places imports with a `PRECISION_LOSS`
warning, so the rounding Postgres does is documented rather than silent.

Display rounding is a UI concern and happens nowhere near storage.

---

## Sources

| Code | Source | Country | Role |
|---|---|---|---|
| `IFCT` | Indian Food Composition Tables (ICMR-NIN) | IN | Primary food composition source |
| `INDB` | Indian Nutrient Databank | IN | Prepared and composite dishes |
| `ICMR_NIN_RDA` | ICMR-NIN RDA / EAR | IN | Requirement values (no data imported) |
| `ICMR_NIN_DG` | ICMR-NIN Dietary Guidelines | IN | Narrative guidance |
| `USDA_FDC` | USDA FoodData Central | US | Fallback for gaps only |

Vyom V1 is **India-first**. USDA is registered for foods absent from Indian
datasets, never as the default source for an Indian food. No US, UK, or EU
nutrition *rules* exist anywhere in this codebase.

### Licence and permission status

Four fields per source, all defaulting to "not established":

- `permissionStatus` — `DEVELOPMENT_ONLY` · `PENDING_REVIEW` · `APPROVED` · `REJECTED`
- `commercialUseStatus` — `UNKNOWN` · `PERMITTED` · `RESTRICTED` · `PROHIBITED`
- `redistributionStatus` — same values
- `attributionRequired` — defaults to **true**

**Nothing in this codebase may set `APPROVED` or `PERMITTED`.** Those are human
legal determinations, recorded deliberately against a specific dataset after
someone has read its terms. The registry sync writes licence fields **on create
only** and never resets them, so a recorded review decision survives a re-run
and a changed default in code cannot silently grant a clearance nobody made. A
test covers both directions.

USDA FoodData Central is widely described as public domain. It is still
registered `UNKNOWN`, because that has not been verified for this project, and
recording a belief as a cleared status is exactly the mistake these columns
exist to prevent.

Each source also carries a `reviewNote` saying what would have to happen before
production use.

### Development vs production policy

- Raw datasets are **never committed**. `data/nutrition/` is git-ignored.
- They are never in `public/`, `src/app/`, a bundle, or Supabase Storage.
- The web application never reads a dataset file. Only the CLI does.
- `source_foods` — which holds raw payloads — is unreadable through the API.
- Before launch, every source in use needs its terms reviewed and its status
  recorded. Until then the honest answer is the default one.

---

## Source adapters

Two routes in, and the difference matters.

**Manifests** serve datasets that genuinely are one flat table of nutrient
columns. **Adapters** serve the ones that are not.

INDB publishes every nutrient twice — per 100 g and per serving — and names its
portions without stating what they weigh. Expressing that in manifest syntax
would have meant inventing manifest features for one publisher's layout, and the
next publisher would need different ones. So source-specific knowledge lives in
an adapter, and everything downstream — validation, provenance, idempotence,
batching, reporting — stays identical for every source.

```
IFCT rows  -+
INDB rows  -+-> adapter -> NormalizedFood[] -> validate -> database
USDA rows  -+
```

Adapters are **pure**: rows in, records out. They do not read files, touch the
database, or log — which is what makes them testable against a handful of
fixture rows instead of a 12 MB download. File reading lives in `scripts/`, so
the spreadsheet dependency can never reach a browser bundle.

| Source | Adapter | Why |
|---|---|---|
| INDB | yes — `src/lib/nutrition/adapters/indb.ts` | File inspected, columns known |
| IFCT | no | No file — the PDF denies text extraction |
| USDA | no | Arrives with the download, once its schema is inspected |

An adapter is written **only after a real file has been inspected**. Writing one
against a dataset nobody has opened means guessing column names, nutrient
meanings, and units — which fails loudly at best and imports subtly wrong
nutrition at worst.

### Recorded column mapping

Every adapter declares its columns up front, and they are written to
`source_nutrient_mappings` **before any row is processed** — so the mapping a run
used survives even if the run later fails.

A column the adapter cannot map is stored as `UNMAPPED` with the reason, not
dropped. INDB's `vitb9_ug` is the worked example: B9 is folate, which INDB also
publishes as `folate_ug`. Mapping both would write one nutrient twice, and
picking one silently would hide any disagreement between them.

---

## Serving sizes

The table that makes the food database usable by a practitioner. A dietitian
records "one bowl of khichdi", not "574 grams of khichdi", and a client logging
a meal certainly does not weigh it.

### Weights are never invented — but they can be recovered

Phase 8A deliberately seeded no household conversion, because an unsourced
"1 cup of rice = N g" is a fabricated number underneath every later calculation.
That still holds.

INDB, however, publishes every nutrient twice. Each pair independently implies a
weight:

```
grams = per_serving / per_100g * 100
```

With 39 nutrient pairs per row, there are 39 independent estimates of the same
number. Across the release **every row agreed to 0.000%**. A number the source
committed to 39 times over is not a guess — and unlike a guess, every step is
reproducible from the file.

So each serving records **how** its weight was established:

| `weightMethod` | Meaning |
|---|---|
| `PUBLISHED` | The source stated it outright |
| `DERIVED_FROM_SOURCE` | Recovered from the source's own arithmetic, with `agreementSpread` recording how firmly |
| `UNKNOWN` | Named portion, no weight — `weightGrams` is null |

A row whose nutrients disagree beyond 0.5% gets **no weight at all** rather than
an averaged one. A database CHECK enforces that a weight and its method travel
together, so "we do not know what a bowl weighs" and "a bowl weighs 173 g" can
never become indistinguishable.

---

## Names and search

Real dataset names look like this:

> `Plain khitchdi (Plain khichri/khichdi)` and `Hot tea (Garam Chai)`

A dietitian types "khichdi" or "chai". Matching the published string fails,
because the word is behind a bracket and a slash.

So a food carries two names. `canonicalName` is what the source published,
never altered — which is what keeps the record verifiable against the printed
table. `normalizedName` is the flattened comparison form, and search matches
only against that.

**No aliases are created from parentheticals.** "(Garam Chai)" is an alternative
name and "(with semolina)" is a qualifier, and no reliable rule separates them.
Guessing would invent aliases; instead the bracketed words land in the
normalized form, so search finds them without an unverified alias row existing.

Normalization keeps letters, **combining marks**, and digits from every script.
The combining marks are easy to overlook and not optional: Indic vowel signs are
marks rather than letters, so a filter without them turns "दाल" into "द ल" and
makes every Devanagari name unfindable. A test covers it.

Search is server-side, paginated, and ordered deterministically by name then id
— without the id tiebreak, two foods sharing a name could swap places between
pages, showing one twice and another never. Matching is `AND` across words and
`OR` across fields, so a second word narrows rather than widens. Nothing is
fuzzy or phonetic: "dal" and "daal" are different strings, and guessing between
them is how a plan gets built on the wrong food.

---

## Ingestion

### Manifests

A manifest is the contract between a dataset and Vyom's model: which file,
which columns mean what, which nutrient each numeric column carries.

Writing a parser per dataset would mean new code for every source and a fresh
chance to get a unit wrong each time. A manifest turns "support a new dataset"
into reviewable data — someone holding the printed tables can check a
column-to-nutrient assignment written in JSON; they cannot check one buried in
code.

```json
{
  "source": "IFCT",
  "version": "2017",
  "file": "ifct-2017.csv",
  "identifierColumn": "food_code",
  "nameColumn": "food_name",
  "categoryColumn": "food_group",
  "categoryMap": { "Cereals and Millets": "GRAINS" },
  "defaultCategory": "OTHER",
  "foodType": "RAW",
  "basis": { "quantity": 100, "unit": "g" },
  "missingValues": ["", "-", "NA"],
  "aliasColumns": [{ "column": "regional_names", "separator": ";" }],
  "nutrients": [
    { "column": "energy_kcal", "nutrient": "ENERGY",  "unit": "KCAL" },
    { "column": "protein_g",   "nutrient": "PROTEIN", "unit": "G" }
  ]
}
```

The column names above are **illustrative**. No IFCT or INDB file is in this
repository, so the real column names are unknown — fill them in from the actual
file. Getting them wrong is safe: a declared column that does not exist fails
the run before a single row is written.

`unit` is required on every nutrient and is never inferred. If it disagrees with
the dictionary, the manifest is **rejected rather than converted** — the IU-to-µg
factor depends on the compound, and an mg/µg slip is a factor of a thousand in a
clinical figure.

`file` must be a plain file name. Path separators and parent references are
refused by the schema, and containment is re-checked when the path is resolved.

### Running an import

```bash
npm run nutrition:registry          # sources, nutrients, units — no values

# adapter route, for datasets with real structure
npm run nutrition:import-source -- --source INDB --version 2024.11 \
    --file raw/indb/Anuvaad_INDB_2024.11.xlsx --dry-run
npm run nutrition:import-source -- --source INDB --version 2024.11 \
    --file raw/indb/Anuvaad_INDB_2024.11.xlsx

# manifest route, for flat nutrient tables
npm run nutrition:import -- --manifest <file>.json --dry-run

npm run nutrition:report            # data quality
npm run nutrition:verify            # security assertions
```

Both the manifest and its data file live in `NUTRITION_DATA_DIR` (default
`data/nutrition`, git-ignored). The directory starts empty — the datasets are
not ours to commit.

`--dry-run` reports exactly what a real run would do and writes nothing but the
manifest row.

Exit codes: `0` completed, `1` failed, `2` partial. A partial import is a real
outcome, not a success, or CI would treat a half-imported dataset as fine.

### Idempotence

Running the same import twice produces the same database, not two copies. Foods
and source records are keyed on the publisher's own identifier:

| Entity | Key |
|---|---|
| Food | (source version, publisher's food id) |
| Source food | (source version, publisher's food id) |

Nutrient values, servings, and aliases are **replaced** for that food and source
version, inside the same transaction that rewrites them. Two reasons, and both
matter: a value the publisher removed in a later release should disappear, which
row-by-row upserts would never do; and a thousand records times forty nutrients
is forty thousand round trips, which no sensible transaction budget survives.

This is not "solving duplicates by deleting". The delete is scoped to one food
and one source version and touches no other source — another release's values
for the same food are untouched.

The same identifier appearing twice **within one file** is a different problem:
the first row wins, the second is skipped and reported. Silently letting the
later row overwrite would make the import order-dependent.

Names are never used for matching. "Milk", "Milk, whole", and "Milk, toned" are
different foods with different nutrition, and merging them on similarity would
be a clinical error. Ambiguity is parked at `REVIEW_REQUIRED` for a human. There
is no AI matching, by design.

### Failure safety

Records are written in batches, each in its own transaction. One transaction
across a large dataset would hold locks for the whole run and lose everything to
a single bad row; per-batch transactions mean a failure leaves whole records
committed and whole records absent, never half a food.

The manifest row is written **before** work starts, so a crashed run leaves a
`RUNNING` row rather than no evidence at all. Because imports are idempotent, the
fix is to run it again.

| Status | Meaning |
|---|---|
| `RUNNING` | started, not yet finished |
| `COMPLETED` | no errors |
| `PARTIAL` | valid records imported, some rows failed |
| `FAILED` | nothing usable — e.g. a declared column is missing |

### Validation

| Check | Outcome |
|---|---|
| Declared column absent from the file | **run fails before any write** |
| No identifier / no name | record rejected |
| Value not numeric | error, value skipped |
| Negative value | error, value skipped |
| More than 8 integer digits | error, value skipped |
| More than 6 decimal places | warning, value imported |
| Thousands separator (`1,234`) | error — ambiguous, never guessed |
| Unmapped category | warning, falls back, publisher's wording kept |
| Repeated identifier in one file | error, later row skipped |
| Nutrient unit ≠ dictionary | manifest rejected |

The database enforces its own layer regardless of what the importer does:
non-negative values, positive basis, non-blank names, all-or-nothing provenance,
`MAPPED` implying a food, and one global conversion per unit pair.

---

## Units

Grams and millilitres are canonical. `kg → g` and `L → ml` are the **only**
seeded conversions, and both are SI definitions rather than measurements.

**No household portion weight is seeded.** A katori of dal and a katori of rice
do not weigh the same, so no global factor can exist; picking a plausible number
for "1 cup of cooked rice" would put an invented value underneath every
calculation built on top of it. Those come from published portion references and
arrive with the phase that has them.

Even `tsp` and `tbsp` are left unconverted: 15 ml is the metric definition and
14.79 ml is the US one, and choosing between them is a decision, not a fact this
codebase gets to make quietly.

The conversion *engine* is a later phase. Phase 8A defines only the vocabulary
and the shape of a conversion.

---

## Security

| | Read | Write |
|---|---|---|
| OWNER / DIETITIAN / SUPER_ADMIN | ✓ reference tables | ✗ |
| RECEPTIONIST | ✗ | ✗ |
| Signed out | ✗ | ✗ |
| `source_foods`, `dataset_imports` | ✗ (nobody, via browser) | ✗ |

### A new RLS shape

Every helper before this phase answers *"which organizations may this user
see?"* and returns a set of ids, because every table before this one is
tenant-owned. Reference data belongs to no organization, so the question is
different — *"may this user read clinical reference data at all?"* — and
`vyom_private.is_clinical_user()` returns a boolean.

These policies therefore carry **no `organization_id` predicate**. That is not
an omission. A cross-tenant read here is correct behaviour; a cross-tenant read
on clients or assessments remains a breach, and no policy added in this phase
touches those tables. `nutrition:verify` asserts the tenant policies still number
ten, the three earlier helpers still exist, and no tenant policy has picked up
the global helper.

RECEPTIONIST is excluded for consistency with the Phase 7 clinical boundary.
Reference nutrition data is not health information about a person and would be
harmless for them to read — but the food database exists to serve clinical work,
a receptionist has no workflow that reaches it, and one definition of "clinical
user" is easier to reason about than two.

### Read-only means read-only

`SELECT` is the only grant. There is no INSERT, UPDATE, or DELETE policy or
grant on any reference table, so a dietitian cannot rewrite the protein figure
every plan in the product will be built on. Imports run as the table owner
through server-side code.

`source_foods` and `dataset_imports` have RLS enabled with **zero policies and
zero grants** — a complete denial for any non-owner role. `source_foods` holds
raw dataset payloads whose redistribution terms are unreviewed and must not
become a way to extract a dataset through the API; `dataset_imports` is
operational telemetry. A future Super Admin surface reads them through Prisma,
behind the Data Access Layer.

As always: **RLS protects the browser → Supabase path, the DAL protects the
server path.** Prisma connects as the table owner and bypasses RLS entirely. See
[security.md](security.md).

---

## Not implemented in Phase 8A

Nutrition calculation engine · BMR · TDEE · calorie or macro targets · meal
plans · recipes · meals · the food database UI · food frequency parsing ·
portion conversion engine · Super Admin dashboard · **any AI**.

No requirement value (RDA, EAR) exists in this codebase. `ICMR_NIN_RDA` is
registered so those values have somewhere provenanced to live when they arrive.

There is no application-side read service yet. Nothing renders a food, so a
service with no caller would be dead code; it arrives with the UI that needs it.

---

## Files

| Path | Role |
|---|---|
| `prisma/migrations/20260818090000_nutrition_reference_data/` | Schema, constraints, RLS |
| `src/lib/nutrition/nutrients.ts` | Nutrient dictionary (vocabulary, no values) |
| `src/lib/nutrition/units.ts` | Unit vocabulary and SI conversions |
| `src/lib/nutrition/sources.ts` | Source registry and licence posture |
| `src/lib/nutrition/data-dir.ts` | Dataset directory and path containment |
| `src/lib/nutrition/ingest/` | CSV, normalize/validate, report |
| `src/validations/nutrition.ts` | Manifest schema |
| `src/services/nutrition/registry.ts` | Vocabulary sync |
| `src/services/nutrition/import.ts` | Ingestion orchestration |
| `scripts/nutrition/` | `registry` · `import` · `report` · `verify` |
